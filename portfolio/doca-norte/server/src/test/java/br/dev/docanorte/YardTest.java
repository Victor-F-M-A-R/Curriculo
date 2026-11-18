package br.dev.docanorte;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
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
class YardTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry props) {
    props.add("spring.datasource.url", () ->
      System.getenv().getOrDefault(
        "TEST_JDBC_URL",
        "jdbc:h2:mem:tests;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
      )
    );
    props.add("spring.datasource.username", () ->
      System.getenv().getOrDefault("TEST_DB_USER", "sa")
    );
    props.add("spring.datasource.password", () ->
      System.getenv().getOrDefault("TEST_DB_PASSWORD", "")
    );
  }

  @Autowired
  Yard yard;

  @Autowired
  JdbcTemplate db;

  @Autowired
  MockMvc mvc;

  @BeforeEach
  void clear() {
    db.update("delete from movement");
    db.update(
      "update dock set status='free',carrier='',version=0 where id='D1'"
    );
  }

  static Yard.Command book(String carrier) {
    return new Yard.Command("book", carrier, 0);
  }

  @Test
  void fullCycleAndRetry() {
    UUID key = UUID.randomUUID();
    yard.apply("D1", key, book("Safira"), "operator");
    assertThat(
      yard.apply("D1", key, book("Safira"), "operator").version()
    ).isEqualTo(1);
    assertThatThrownBy(() ->
      yard.apply("D1", key, book("Outra"), "operator")
    ).isInstanceOf(ResponseStatusException.class);
    yard.apply(
      "D1",
      UUID.randomUUID(),
      new Yard.Command("start", "", 1),
      "operator"
    );
    var dock = yard.apply(
      "D1",
      UUID.randomUUID(),
      new Yard.Command("release", "", 2),
      "operator"
    );
    assertThat(dock.status()).isEqualTo("free");
    assertThat(dock.carrier()).isEmpty();
    assertThat(yard.snapshot().moves()).extracting(Yard.Move::dockVersion)
      .containsExactlyInAnyOrder(1L, 2L, 3L);
  }

  @Test
  void concurrentBookingsHaveExactlyOneWinner() throws Exception {
    var gate = new CountDownLatch(1);
    try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
      Callable<Integer> contender = () -> {
        gate.await();
        try {
          yard.apply("D1", UUID.randomUUID(), book("Caju"), "operator");
          return 200;
        } catch (ResponseStatusException e) {
          return e.getStatusCode().value();
        }
      };
      var a = pool.submit(contender);
      var b = pool.submit(contender);
      gate.countDown();
      assertThat(
        List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS))
      ).containsExactlyInAnyOrder(200, 409);
    }
    assertThat(yard.snapshot().moves()).hasSize(1);
  }

  @Test
  void restRequiresCsrfAndValidatesArguments() throws Exception {
    var path = "/api/docks/D1/moves";
    mvc
      .perform(
        post(path)
          .header("Idempotency-Key", UUID.randomUUID())
          .contentType("application/json")
          .content(
            "{\"action\":\"book\",\"carrier\":\"Caju\",\"expectedVersion\":0}"
          )
      )
      .andExpect(status().isForbidden());
    mvc
      .perform(
        post(path)
          .with(csrf())
          .header("Idempotency-Key", UUID.randomUUID())
          .contentType("application/json")
          .content(
            "{\"action\":\"book\",\"carrier\":\"  \",\"expectedVersion\":0}"
          )
      )
      .andExpect(status().isBadRequest());
    mvc
      .perform(get("/api/yard"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.docks.length()").value(6));
  }

  @Test
  void aMoveNeedsAnExplicitObservedVersion() throws Exception {
    var path = "/api/docks/D1/moves";
    for (var body : List.of(
      "{\"action\":\"book\",\"carrier\":\"Arara\"}",
      "{\"action\":\"book\",\"carrier\":\"Arara\",\"expectedVersion\":null}"
    )) {
      mvc.perform(post(path).with(csrf())
          .header("Idempotency-Key", UUID.randomUUID())
          .contentType("application/json").content(body))
        .andExpect(status().isBadRequest());
    }
    assertThat(yard.snapshot().moves()).isEmpty();
  }

  @Test
  void staleCommandAndInvalidTransitionLeaveNoEvent() {
    assertThatThrownBy(() ->
      yard.apply(
        "D1",
        UUID.randomUUID(),
        new Yard.Command("release", "", 0),
        "x"
      )
    ).isInstanceOf(ResponseStatusException.class);
    assertThatThrownBy(() ->
      yard.apply("D1", UUID.randomUUID(), new Yard.Command("book", "X", 9), "x")
    ).isInstanceOf(ResponseStatusException.class);
    assertThat(yard.snapshot().moves()).isEmpty();
  }
}
