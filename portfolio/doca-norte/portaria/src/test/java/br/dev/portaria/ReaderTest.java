package br.dev.portaria;

import static org.assertj.core.api.Assertions.*;

import java.time.Instant;
import java.util.List;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.server.ResponseStatusException;

class ReaderTest {

  private List<Reader.Dock> docks() {
    return java.util.stream.IntStream.rangeClosed(1, 6)
      .mapToObj(i -> new Reader.Dock("D" + i, "Doca " + i, "Seca", "free", "")).toList();
  }

  @Test
  void sourceTimeIsPreservedAndMalformedReadingsAreRejected() {
    var now = Instant.now();
    var original = now.minusSeconds(13);
    var board = Reader.validate(now, new Reader.Snapshot(docks(), original));
    assertThat(board.sampledAt()).isEqualTo(original);
    assertThat(Reader.at(now, board).stale()).isTrue();
    for (var sample : List.of(
      new Reader.Snapshot(docks(), null), new Reader.Snapshot(docks(), now.plusSeconds(6)),
      new Reader.Snapshot(docks(), now.minusSeconds(121)), new Reader.Snapshot(List.of(), now),
      new Reader.Snapshot(java.util.Collections.nCopies(6, docks().getFirst()), now)
    )) assertThatThrownBy(() -> Reader.validate(now, sample)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void futureClockAndMissingTimestampCannotBecomeFresh() {
    var now = Instant.now();
    assertThatThrownBy(() -> Reader.at(now, new Reader.Board(docks(), now.plusSeconds(6), false)))
      .isInstanceOf(ResponseStatusException.class);
    assertThatThrownBy(() -> Reader.at(now, new Reader.Board(docks(), null, false)))
      .isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void freshnessIsExplicitAndExpiredSnapshotsAreUnavailable() {
    var now = Instant.EPOCH;
    var sample = new Reader.Board(List.of(), now, false);
    assertThat(Reader.at(now.plusSeconds(5), sample).stale()).isFalse();
    assertThat(Reader.at(now.plusSeconds(13), sample).stale()).isTrue();
    assertThatThrownBy(() ->
      Reader.at(now.plusSeconds(121), sample)
    ).isInstanceOf(ResponseStatusException.class);
    assertThatThrownBy(() -> Reader.at(now, null)).isInstanceOf(
      ResponseStatusException.class
    );
  }

  @Test
  void fractionalSecondsDoNotExtendFreshnessOrAvailability() {
    var origin = Instant.parse("2026-11-20T12:00:00Z");
    var sample = new Reader.Board(docks(), origin, false);
    assertThat(Reader.at(origin.plusSeconds(12), sample).stale()).isFalse();
    assertThat(Reader.at(origin.plusSeconds(12).plusNanos(1), sample).stale()).isTrue();
    assertThat(Reader.at(origin.plusSeconds(120), sample).stale()).isTrue();
    assertThatThrownBy(() -> Reader.at(origin.plusSeconds(120).plusNanos(1), sample))
      .isInstanceOfSatisfying(ResponseStatusException.class,
        error -> assertThat(error.getStatusCode().value()).isEqualTo(503));
  }

  @ParameterizedTest
  @ValueSource(ints = {401, 403})
  void upstreamAuthorizationLossClearsCacheUntilAValidHttpReading(int denial) throws Exception {
    var mapper = new ObjectMapper().findAndRegisterModules()
      .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    var status = new AtomicInteger(200);
    var body = new AtomicReference<>(mapper.writeValueAsBytes(new Reader.Snapshot(docks(), Instant.now())));
    var receivedToken = new AtomicReference<String>();
    var origin = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    origin.createContext("/api/yard", exchange -> {
      try {
        receivedToken.set(exchange.getRequestHeaders().getFirst("X-Yard-Reader"));
        byte[] bytes = body.get();
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status.get(), bytes.length);
        exchange.getResponseBody().write(bytes);
      } finally {
        exchange.close();
      }
    });
    origin.start();
    try {
      var reader = new Reader("http://127.0.0.1:" + origin.getAddress().getPort(), "synthetic-reader");
      reader.poll();
      var confirmed = reader.board(new MockHttpServletResponse());
      assertThat(confirmed.docks()).hasSize(6);
      assertThat(receivedToken.get()).isEqualTo("synthetic-reader");
      status.set(503);
      reader.poll();
      assertThat(reader.board(new MockHttpServletResponse()).sampledAt()).isEqualTo(confirmed.sampledAt());
      for (int next : new int[]{denial, 503, 200}) {
        status.set(next);
        // A malformed success after denial is not reauthorization either.
        if (next == 200) body.set(mapper.writeValueAsBytes(new Reader.Snapshot(List.of(), Instant.now())));
        reader.poll();
        assertThatThrownBy(() -> reader.board(new MockHttpServletResponse()))
          .isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(denial));
      }
      body.set(mapper.writeValueAsBytes(new Reader.Snapshot(docks(), Instant.now())));
      reader.poll();
      var response = new MockHttpServletResponse();
      assertThat(reader.board(response).docks()).hasSize(6);
      assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
    } finally {
      origin.stop(0);
    }
  }
}
