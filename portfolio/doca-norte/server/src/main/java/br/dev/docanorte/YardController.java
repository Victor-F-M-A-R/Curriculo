package br.dev.docanorte;

import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
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
  Yard.Snapshot snapshot() {
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
}
