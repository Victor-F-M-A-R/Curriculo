package br.dev.portaria;

import static org.assertj.core.api.Assertions.*;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
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
}
