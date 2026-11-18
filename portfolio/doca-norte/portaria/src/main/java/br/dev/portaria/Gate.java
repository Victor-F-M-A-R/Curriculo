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

  record Snapshot(List<Dock> docks) {}

  record Board(List<Dock> docks, Instant sampledAt, boolean stale) {}

  private final RestClient client;
  private volatile Board last;

  Reader(@Value("${yard.origin}") String origin) {
    var factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Duration.ofSeconds(2));
    factory.setReadTimeout(Duration.ofSeconds(3));
    client = RestClient.builder()
      .baseUrl(origin)
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
      if (sample != null && sample.docks() != null) last = new Board(
        List.copyOf(sample.docks()),
        Instant.now(),
        false
      );
    } catch (RestClientException e) {
      LoggerFactory.getLogger(Reader.class).warn(
        "Pátio indisponível · {}",
        e.getClass().getSimpleName()
      );
    }
  }

  @GetMapping("/api/field")
  Board board() {
    return at(Instant.now(), last);
  }

  static Board at(Instant now, Board previous) {
    if (
      previous == null ||
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
