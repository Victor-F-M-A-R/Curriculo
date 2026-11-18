package br.dev.portaria;

import static org.assertj.core.api.Assertions.*;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class ReaderTest {

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
}
