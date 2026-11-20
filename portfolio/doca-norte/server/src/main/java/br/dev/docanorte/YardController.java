package br.dev.docanorte;

import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.dao.DataAccessException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.transaction.TransactionException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
class YardController {

  private final Yard yard;
  private final Access access;

  YardController(Yard yard, Access access) {
    this.yard = yard;
    this.access = access;
  }

  @GetMapping("/yard")
  Yard.Snapshot snapshot(Authentication auth, @RequestHeader(value = "X-Yard-Reader", required = false) String reader) {
    if (!access.mayRead(auth, reader)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Entre novamente para consultar o pátio.");
    return yard.snapshot();
  }

  @GetMapping("/session")
  Map<String, Object> session(Authentication auth, CsrfToken csrf) {
    return Map.of(
      "actor",
      access.name(auth),
      "canWrite",
      access.mayWrite(auth),
      "federated",
      access.federated(),
      "authenticated",
      access.currentIdentity(auth),
      "csrfHeader",
      csrf.getHeaderName(),
      "csrf",
      csrf.getToken()
    );
  }

  @PostMapping("/docks/{id}/moves")
  Yard.Dock move(
    @PathVariable String id,
    @RequestHeader("Idempotency-Key") UUID key,
    @RequestBody Yard.Command command,
    Authentication auth
  ) {
    if (!access.mayWrite(auth)) throw new ResponseStatusException(
      HttpStatus.FORBIDDEN,
      "Requer perfil de operador."
    );
    return yard.apply(id, key, command, access.name(auth));
  }

  @ExceptionHandler(ResponseStatusException.class)
  ResponseEntity<?> domainProblem(ResponseStatusException error) {
    return ResponseEntity.status(error.getStatusCode()).body(
      Map.of("detail", error.getReason())
    );
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<?> invalidJson(HttpMessageNotReadableException error) {
    for (Throwable cause = error; cause != null; cause = cause.getCause()) {
      if (cause instanceof RequestPolicy.PayloadTooLarge)
        return ResponseEntity.status(413).body(Map.of("detail", "O comando excede o limite de 16 KiB."));
    }
    return ResponseEntity.badRequest().body(Map.of("detail", "Comando JSON inválido. Confira os campos e seus tipos."));
  }

  @ExceptionHandler({DataAccessException.class, TransactionException.class})
  ResponseEntity<?> storageUnavailable(RuntimeException error) {
    org.slf4j.LoggerFactory.getLogger(YardController.class).warn("Persistência temporariamente indisponível: {}", error.getClass().getSimpleName());
    return ResponseEntity.status(503).header("Retry-After", "2")
      .body(Map.of("detail", "Não foi possível confirmar a operação. Atualize o pátio e repita com a mesma identificação se necessário."));
  }
}
