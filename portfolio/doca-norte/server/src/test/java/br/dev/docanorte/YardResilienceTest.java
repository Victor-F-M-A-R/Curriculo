package br.dev.docanorte;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@AutoConfigureMockMvc
class YardResilienceTest {
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    properties.add("spring.datasource.url", () -> System.getenv().getOrDefault(
      "TEST_JDBC_URL", "jdbc:h2:mem:resilience;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"));
    properties.add("spring.datasource.username", () -> System.getenv().getOrDefault("TEST_DB_USER", "sa"));
    properties.add("spring.datasource.password", () -> System.getenv().getOrDefault("TEST_DB_PASSWORD", ""));
  }

  @Autowired Yard yard;
  @Autowired JdbcTemplate db;
  @Autowired DataSource source;
  @Autowired MockMvc mvc;

  @BeforeEach
  void reset() {
    db.update("delete from movement");
    db.update("update dock set status='free',carrier='',version=0");
  }

  @Test
  void malformedCommandsNeverCoerceOrWrite() throws Exception {
    for (var body : List.of(
      "{\"action\":\"book\",\"carrier\":\"Caju\",\"expectedVersion\":0.9}",
      "{\"action\":\"book\",\"carrier\":\"Caju\",\"expectedVersion\":\"0\"}",
      "{\"action\":\"book\",\"carrier\":123,\"expectedVersion\":0}",
      "{\"action\":\"book\",\"carrier\":\"Caju\",\"expectedVersion\":0,\"expectedVersion\":0}",
      "{\"action\":\"book\",\"carrier\":\"Caju\",\"expectedVersion\":0,\"unexpected\":true}",
      "{\"action\":\"book\",\"carrier\":\"Caju\",\"expectedVersion\":0} {}",
      "{\"action\":\"book\",\"carrier\":\"Caju\\nSul\",\"expectedVersion\":0}"
    )) {
      mvc.perform(post("/api/docks/D1/moves").with(csrf())
          .header("Idempotency-Key", UUID.randomUUID()).contentType("application/json").content(body))
        .andExpect(status().isBadRequest());
      assertThat(yard.snapshot().moves()).as(body).isEmpty();
    }
  }

  @Test
  void excessiveJsonIsRejectedBeforeDomainWork() throws Exception {
    mvc.perform(post("/api/docks/D1/moves").with(csrf())
        .header("Idempotency-Key", UUID.randomUUID()).contentType("application/json")
        .content("{\"action\":\"book\",\"carrier\":\"" + "x".repeat(20_000) + "\",\"expectedVersion\":0}"))
      .andExpect(status().isPayloadTooLarge());
    assertThat(yard.snapshot().moves()).isEmpty();
  }

  @Test
  void repeatedConcurrentCommandCreatesOneDurableMovement() throws Exception {
    var start = new CountDownLatch(1);
    var key = UUID.randomUUID();
    var command = new Yard.Command("book", "Concorrente", 0);
    try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
      var replies = new ArrayList<Future<Yard.Dock>>();
      for (int i = 0; i < 12; i++) replies.add(workers.submit(() -> {
        start.await();
        return yard.apply("D1", key, command, "operator");
      }));
      start.countDown();
      for (var reply : replies) assertThat(reply.get(10, TimeUnit.SECONDS).version()).isEqualTo(1);
    }
    assertThat(db.queryForObject("select count(*) from movement", Integer.class)).isEqualTo(1);
    assertThatThrownBy(() -> yard.apply("D1", key, command, "another-operator"))
      .isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void ledgerFailureRollsBackTheDockAndAllowsSameKeyRetry() {
    var key = UUID.randomUUID();
    db.execute("alter table movement add constraint qa_reject_carrier check (carrier <> 'Reject')");
    try {
      assertThatThrownBy(() -> yard.apply("D1", key, new Yard.Command("book", "Reject", 0), "operator"))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
      assertThat(yard.snapshot().docks().getFirst().status()).isEqualTo("free");
      assertThat(yard.snapshot().docks().getFirst().version()).isZero();
      assertThat(yard.snapshot().moves()).isEmpty();
    } finally {
      db.execute("alter table movement drop constraint qa_reject_carrier");
    }
    assertThat(yard.apply("D1", key, new Yard.Command("book", "Reject", 0), "operator").version()).isEqualTo(1);
  }

  @Test
  void lockedDockReturnsBoundedRetryableFailureWithoutPartialWrite() throws Exception {
    var key = UUID.randomUUID();
    var started = System.nanoTime();
    try (var holder = source.getConnection(); var workers = Executors.newVirtualThreadPerTaskExecutor()) {
      holder.setAutoCommit(false);
      try (var statement = holder.prepareStatement("select id from dock where id='D1' for update")) {
        statement.executeQuery().close();
      }
      try {
        var response = workers.submit(() -> mvc.perform(post("/api/docks/D1/moves").with(csrf())
          .header("Idempotency-Key", key).contentType("application/json")
          .content("{\"action\":\"book\",\"carrier\":\"Retry\",\"expectedVersion\":0}"))
          .andReturn().getResponse());
        var reply = response.get(8, TimeUnit.SECONDS);
        assertThat(reply.getStatus()).isEqualTo(503);
        assertThat(reply.getHeader("Retry-After")).isEqualTo("2");
      } finally {
        holder.rollback();
      }
    }
    assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(9));
    assertThat(yard.snapshot().moves()).isEmpty();
    assertThat(yard.apply("D1", key, new Yard.Command("book", "Retry", 0), "operator").version()).isEqualTo(1);
  }

  @Test
  void randomizedOperationsPreserveVersionsAndHistory() {
    var random = new Random(20261120);
    var states = new HashMap<String, String>();
    var versions = new HashMap<String, Long>();
    for (int i = 1; i <= 6; i++) { states.put("D" + i, "free"); versions.put("D" + i, 0L); }
    int accepted = 0;
    for (int step = 0; step < 180; step++) {
      String id = "D" + (1 + random.nextInt(6));
      String action = List.of("book", "start", "release", "cancel").get(random.nextInt(4));
      String prior = states.get(id);
      String next = switch (prior + "/" + action) {
        case "free/book" -> "booked";
        case "booked/start" -> "servicing";
        case "servicing/release", "booked/cancel" -> "free";
        default -> null;
      };
      long observed = versions.get(id) + (random.nextInt(5) == 0 ? 1 : 0);
      var command = new Yard.Command(action, action.equals("book") ? "Teste " + step : "", observed);
      if (next == null || observed != versions.get(id)) {
        assertThatThrownBy(() -> yard.apply(id, UUID.randomUUID(), command, "operator"))
          .isInstanceOf(ResponseStatusException.class);
      } else {
        var result = yard.apply(id, UUID.randomUUID(), command, "operator");
        states.put(id, next); versions.put(id, observed + 1); accepted++;
        assertThat(result.status()).isEqualTo(next);
      }
    }
    for (var dock : yard.snapshot().docks()) {
      assertThat(dock.status()).isEqualTo(states.get(dock.id()));
      assertThat(dock.version()).isEqualTo(versions.get(dock.id()));
      if (dock.status().equals("free")) assertThat(dock.carrier()).isEmpty();
    }
    assertThat(db.queryForObject("select count(*) from movement", Integer.class)).isEqualTo(accepted);
    assertThat(yard.snapshot().moves()).hasSize(Math.min(accepted, 40));
  }
}
