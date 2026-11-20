package br.dev.portaria;

import java.time.*;
import java.util.List;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.*;
import org.springframework.web.server.ResponseStatusException;

@SpringBootApplication
@EnableScheduling
public class Gate {

  public static void main(String[] args) {
    SpringApplication.run(Gate.class, args);
  }
}

@RestController
class Reader {

  record Dock(
    String id,
    String name,
    String cargo,
    String status,
    String carrier
  ) {}

  record Snapshot(List<Dock> docks, Instant sampledAt) {}

  record Board(List<Dock> docks, Instant sampledAt, boolean stale) {}

  private final RestClient client;
  private volatile Board last;

  Reader(@Value("${yard.origin}") String origin, @Value("${yard.reader-token:}") String token) {
    var factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Duration.ofSeconds(2));
    factory.setReadTimeout(Duration.ofSeconds(3));
    client = RestClient.builder()
      .baseUrl(origin)
      .defaultHeader("X-Yard-Reader", token)
      .requestFactory(factory)
      .build();
  }

  @Scheduled(fixedDelayString = "${gate.poll-ms:5000}")
  void poll() {
    try {
      var sample = client
        .get()
        .uri("/api/yard")
        .retrieve()
        .body(Snapshot.class);
      var checked = validate(Instant.now(), sample);
      if (last == null || !checked.sampledAt().isBefore(last.sampledAt())) last = checked;
    } catch (RestClientException | IllegalArgumentException e) {
      LoggerFactory.getLogger(Reader.class).warn(
        "Pátio indisponível · {}",
        e.getClass().getSimpleName()
      );
    }
  }

  @GetMapping("/api/field")
  Board board(jakarta.servlet.http.HttpServletResponse response) {
    response.setHeader("Cache-Control", "no-store");
    return at(Instant.now(), last);
  }

  static Board validate(Instant now, Snapshot sample) {
    if (sample == null || sample.sampledAt() == null || sample.sampledAt().isAfter(now.plusSeconds(5))
        || sample.sampledAt().isBefore(now.minusSeconds(120)) || sample.docks() == null
        || sample.docks().size() != 6) throw new IllegalArgumentException("Quadro inválido");
    var ids = new java.util.HashSet<String>();
    for (var dock : sample.docks()) {
      if (dock == null || dock.id() == null || !dock.id().matches("D[1-6]") || !ids.add(dock.id())
          || dock.name() == null || dock.name().isBlank() || dock.name().length() > 55
          || dock.cargo() == null || dock.cargo().isBlank() || dock.cargo().length() > 40
          || dock.status() == null || !List.of("free", "booked", "servicing").contains(dock.status())
          || dock.carrier() == null || dock.carrier().length() > 50
          || (dock.status().equals("free") != dock.carrier().isBlank()))
        throw new IllegalArgumentException("Doca inválida");
    }
    return new Board(List.copyOf(sample.docks()), sample.sampledAt(), false);
  }

  static Board at(Instant now, Board previous) {
    if (
      previous == null || previous.sampledAt() == null || previous.sampledAt().isAfter(now.plusSeconds(5)) ||
      Duration.between(previous.sampledAt(), now).getSeconds() > 120
    ) throw new ResponseStatusException(
      HttpStatus.SERVICE_UNAVAILABLE,
      "Sem leitura recente."
    );
    return new Board(
      previous.docks(),
      previous.sampledAt(),
      Duration.between(previous.sampledAt(), now).getSeconds() > 12
    );
  }
}
