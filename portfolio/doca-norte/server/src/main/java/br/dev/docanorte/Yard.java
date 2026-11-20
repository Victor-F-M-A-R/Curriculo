package br.dev.docanorte;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import io.micrometer.core.instrument.MeterRegistry;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class Yard {

  public record Dock(
    String id,
    String name,
    String cargo,
    String status,
    String carrier,
    long version
  ) {}

  public record Command(
    String action,
    String carrier,
    @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long expectedVersion
  ) {}

  public record Move(
    String dockId,
    long dockVersion,
    String action,
    String carrier,
    String actor,
    Instant at
  ) {}

  public record Snapshot(List<Dock> docks, List<Move> moves, Instant sampledAt) {}

  private record Recorded(
    String action,
    String carrier,
    long version,
    String actor
  ) {}

  private static final Logger log = LoggerFactory.getLogger(Yard.class);
  private final JdbcTemplate db;
  private final MeterRegistry metrics;

  public Yard(JdbcTemplate db, MeterRegistry metrics) {
    this.db = db;
    this.metrics = metrics;
  }

  private Dock row(ResultSet r, int index) throws SQLException {
    return new Dock(
      r.getString("id"),
      r.getString("name"),
      r.getString("cargo"),
      r.getString("status"),
      r.getString("carrier"),
      r.getLong("version")
    );
  }

  @Transactional(
    readOnly = true,
    timeout = 5,
    isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ
  )
  public Snapshot snapshot() {
    var docks = db.query("select * from dock order by id", this::row);
    var moves = db.query(
      "select * from movement order by occurred_at desc, request_id desc limit 40",
      (r, i) ->
        new Move(
          r.getString("dock_id"),
          r.getLong("expected_version") + 1,
          r.getString("action"),
          r.getString("carrier"),
          r.getString("actor"),
          r.getObject("occurred_at", OffsetDateTime.class).toInstant()
        )
    );
    return new Snapshot(docks, moves, Instant.now());
  }

  @Transactional(timeout = 5)
  public Dock apply(String id, UUID key, Command cmd, String actor) {
    var docks = db.query(
      "select * from dock where id=? for update",
      this::row,
      id
    );
    if (docks.isEmpty()) throw new ResponseStatusException(
      HttpStatus.NOT_FOUND,
      "Doca desconhecida."
    );
    Dock dock = docks.getFirst();
    String carrier = cmd.carrier() == null ? "" : cmd.carrier().strip();
    String action = cmd.action();
    if (
      action == null ||
      !List.of("book", "start", "release", "cancel").contains(action) ||
      carrier.length() > 50 ||
      carrier.codePoints().anyMatch(Character::isISOControl) ||
      ("book".equals(action) && carrier.isBlank()) ||
      (!"book".equals(action) && !carrier.isBlank()) ||
      cmd.expectedVersion() < 0
    ) throw new ResponseStatusException(
      HttpStatus.BAD_REQUEST,
      "Operação ou transportadora inválida."
    );

    var prior = db.query(
      "select * from movement where dock_id=? and request_id=?",
      (r, i) ->
        new Recorded(
          r.getString("action"),
          r.getString("carrier"),
          r.getLong("expected_version"),
          r.getString("actor")
        ),
      id,
      key.toString()
    );
    if (!prior.isEmpty()) {
      Recorded seen = prior.getFirst();
      if (
        !seen.action().equals(action) ||
        seen.version() != cmd.expectedVersion() ||
        !seen.actor().equals(actor) ||
        ("book".equals(action) && !seen.carrier().equals(carrier))
      ) throw conflict();
      return dock;
    }
    String next = switch (dock.status() + "/" + action) {
      case "free/book" -> "booked";
      case "booked/start" -> "servicing";
      case "servicing/release", "booked/cancel" -> "free";
      default -> throw conflict();
    };
    if (dock.version() != cmd.expectedVersion()) throw conflict();
    String movementCarrier = "book".equals(action) ? carrier : dock.carrier();
    String dockCarrier = "free".equals(next) ? "" : movementCarrier;
    db.update(
      "update dock set status=?, carrier=?, version=version+1 where id=?",
      next,
      dockCarrier,
      id
    );
    db.update(
      "insert into movement(dock_id,request_id,action,carrier,expected_version,actor,occurred_at) values(?,?,?,?,?,?,?)",
      id,
      key.toString(),
      action,
      movementCarrier,
      cmd.expectedVersion(),
      actor,
      OffsetDateTime.now()
    );
    metrics.counter("yard.movements", "action", action).increment();
    log.info(
      "movement dock={} action={} version={} request={}",
      id,
      action,
      dock.version() + 1,
      key
    );
    return new Dock(
      id,
      dock.name(),
      dock.cargo(),
      next,
      dockCarrier,
      dock.version() + 1
    );
  }

  private ResponseStatusException conflict() {
    metrics.counter("yard.conflicts").increment();
    return new ResponseStatusException(
      HttpStatus.CONFLICT,
      "A doca mudou. Confira o pátio antes de continuar."
    );
  }
}
