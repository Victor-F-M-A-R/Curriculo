package br.dev.docanorte;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.Execution;
import org.junit.jupiter.api.parallel.ExecutionMode;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Real authorization-code redirects, token exchange and RSA verification over
 * loopback HTTP. The issuer is a local protocol fixture, not a corporate provider.
 * No OidcUser, SecurityContext, decoder or application service is mocked.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
  "spring.datasource.url=jdbc:h2:mem:oidc_protocol;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
  "spring.datasource.username=sa", "spring.datasource.password=",
  "server.address=127.0.0.1", "server.servlet.session.cookie.secure=false",
  "yard.auth-max-age-seconds=8", "yard.reader-token="
})
@ActiveProfiles("oidc")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Execution(ExecutionMode.SAME_THREAD)
class OidcProtocolTest {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final String CLIENT = "yard-protocol-test";
  private static final String SECRET = "local-fixture-secret";
  private static final String SUBJECT = "protocol-operator";
  private static final String OPERATORS = "yard-operators";
  private static final String READERS = "yard-readers";
  private static final Issuer ISSUER = Issuer.start();

  @DynamicPropertySource
  static void identityProvider(DynamicPropertyRegistry props) {
    props.add("OIDC_CLIENT_ID", () -> CLIENT);
    props.add("OIDC_CLIENT_SECRET", () -> SECRET);
    props.add("OIDC_ISSUER", ISSUER::base);
  }

  @LocalServerPort int port;
  @Autowired JdbcTemplate db;

  @BeforeEach
  void cleanData() {
    db.update("delete from movement");
    db.update("update dock set status='free',carrier='',version=0 where id='D1'");
    ISSUER.failure.set(null);
  }

  @AfterAll
  static void closeIssuer() {
    ISSUER.close();
  }

  @Test
  void operatorAuthenticatesThroughDiscoveryAndSignedTokensButStillNeedsCsrf() throws Exception {
    try (Browser browser = new Browser()) {
      assertThat(browser.get("/api/yard").statusCode()).isEqualTo(401);
      login(browser, OPERATORS, Fault.NONE);
      JsonNode session = browser.session();
      assertThat(session.path("federated").asBoolean()).isTrue();
      assertThat(session.path("authenticated").asBoolean()).isTrue();
      assertThat(session.path("actor").asText()).isEqualTo(SUBJECT);
      assertThat(session.path("canWrite").asBoolean()).isTrue();
      assertThat(browser.get("/api/yard").statusCode()).isEqualTo(200);
      assertThat(browser.move("book", "Aurora", 0, null).statusCode()).isEqualTo(403);
      assertThat(browser.move("book", "Aurora", 0, "not-the-session-token").statusCode()).isEqualTo(403);
      assertThat(db.queryForObject("select count(*) from movement", Integer.class)).isZero();
      assertThat(browser.move("book", "Aurora", 0, session.path("csrf").asText()).statusCode()).isEqualTo(200);
      assertThat(db.queryForObject("select actor from movement", String.class)).isEqualTo(SUBJECT);
      assertThat(ISSUER.discoveryRequests.get()).isPositive();
      assertThat(ISSUER.keyRequests.get()).isPositive();
      assertThat(ISSUER.tokenRequests.get()).isPositive();
    }
  }

  @Test
  void aNewLoginReplacesGroupsAndOldCsrfCannotAuthorizeTheNewSession() throws Exception {
    try (Browser browser = new Browser()) {
      login(browser, READERS, Fault.NONE);
      JsonNode reader = browser.session();
      assertThat(reader.path("authenticated").asBoolean()).isTrue();
      assertThat(reader.path("canWrite").asBoolean()).isFalse();
      assertThat(browser.get("/api/yard").statusCode()).isEqualTo(200);
      assertThat(browser.move("book", "Aurora", 0, reader.path("csrf").asText()).statusCode()).isEqualTo(403);

      login(browser, OPERATORS, Fault.NONE);
      JsonNode operator = browser.session();
      assertThat(operator.path("canWrite").asBoolean()).isTrue();
      assertThat(browser.move("book", "Aurora", 0, reader.path("csrf").asText()).statusCode()).isEqualTo(403);
      assertThat(browser.move("book", "Aurora", 0, operator.path("csrf").asText()).statusCode()).isEqualTo(200);

      login(browser, READERS, Fault.NONE);
      JsonNode downgraded = browser.session();
      assertThat(downgraded.path("canWrite").asBoolean()).isFalse();
      assertThat(browser.get("/api/yard").statusCode()).isEqualTo(200);
      assertThat(browser.move("start", "", 1, downgraded.path("csrf").asText()).statusCode()).isEqualTo(403);
      assertThat(db.queryForObject("select count(*) from movement", Integer.class)).isEqualTo(1);
    }
  }

  @ParameterizedTest(name = "invalid {0} cannot establish an authenticated session")
  @EnumSource(value = Fault.class, names = {"STATE", "NONCE", "SIGNATURE", "EXPIRED"})
  void invalidProtocolResponseCannotReadOrWrite(Fault fault) throws Exception {
    try (Browser browser = new Browser()) {
      int exchangesBefore = ISSUER.tokenRequests.get();
      login(browser, OPERATORS, fault);
      JsonNode denied = browser.session();
      assertThat(denied.path("authenticated").asBoolean()).isFalse();
      assertThat(denied.path("canWrite").asBoolean()).isFalse();
      assertThat(browser.get("/api/yard").statusCode()).isEqualTo(401);
      assertThat(browser.move("book", "Denied", 0, denied.path("csrf").asText()).statusCode()).isEqualTo(403);
      assertThat(db.queryForObject("select count(*) from movement", Integer.class)).isZero();
      // Invalid state is rejected before redeeming a code. Other faults reach
      // the token decoder/nonce validator and must fail there.
      assertThat(ISSUER.tokenRequests.get() - exchangesBefore).isEqualTo(fault == Fault.STATE ? 0 : 1);
    }
  }

  @Test
  void authorizationAgeBlocksBothReadsAndWritesUntilANewLogin() throws Exception {
    try (Browser browser = new Browser()) {
      login(browser, OPERATORS, Fault.NONE);
      JsonNode fresh = browser.session();
      assertThat(fresh.path("canWrite").asBoolean()).isTrue();
      assertThat(browser.get("/api/yard").statusCode()).isEqualTo(200);
      Instant tokenExpiration = ISSUER.lastExpiration.get();

      // Keep the HTTP session active while its authorization reaches the short
      // age limit. The signed ID token itself remains valid for ten minutes.
      long deadline = System.nanoTime() + Duration.ofSeconds(12).toNanos();
      JsonNode stale = fresh;
      while (stale.path("authenticated").asBoolean() && System.nanoTime() < deadline) {
        Thread.sleep(100);
        stale = browser.session();
      }
      assertThat(stale.path("authenticated").asBoolean()).isFalse();
      assertThat(tokenExpiration).isAfter(Instant.now());
      assertThat(browser.get("/api/yard").statusCode()).isEqualTo(401);
      assertThat(browser.move("book", "Expired authorization", 0, stale.path("csrf").asText()).statusCode()).isEqualTo(403);

      login(browser, OPERATORS, Fault.NONE);
      JsonNode renewed = browser.session();
      assertThat(renewed.path("authenticated").asBoolean()).isTrue();
      assertThat(renewed.path("canWrite").asBoolean()).isTrue();
      assertThat(browser.get("/api/yard").statusCode()).isEqualTo(200);
      assertThat(browser.move("book", "Renewed authorization", 0, renewed.path("csrf").asText()).statusCode()).isEqualTo(200);
    }
  }

  private void login(Browser browser, String group, Fault fault) throws Exception {
    ISSUER.next.set(new Login(group, fault));
    HttpResponse<String> start = browser.get("/oauth2/authorization/yard");
    assertThat(start.statusCode()).isEqualTo(302);
    URI authorization = redirect(start);
    assertThat(authorization.toString()).startsWith(ISSUER.base() + "/authorize?");
    Map<String, String> parameters = form(authorization.getRawQuery());
    assertThat(parameters.get("state")).isNotBlank();
    assertThat(parameters.get("nonce")).isNotBlank();
    assertThat(parameters.get("scope")).contains("openid");
    assertThat(parameters.get("redirect_uri")).isEqualTo(base() + "/login/oauth2/code/yard");

    HttpResponse<String> authorized = browser.request(authorization);
    assertThat(authorized.statusCode()).isEqualTo(302);
    HttpResponse<String> callback = browser.request(redirect(authorized));
    assertThat(ISSUER.failure.get()).isNull();
    assertThat(callback.statusCode()).isEqualTo(302);
    URI target = redirect(callback);
    if (fault == Fault.NONE) assertThat(target.getPath()).isEqualTo("/");
    else assertThat(target.getQuery()).contains("error");
  }

  private String base() { return "http://127.0.0.1:" + port; }

  private static URI redirect(HttpResponse<?> response) {
    return response.uri().resolve(response.headers().firstValue("location").orElseThrow());
  }

  private final class Browser implements AutoCloseable {
    private final HttpClient client = HttpClient.newBuilder()
      .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
      .followRedirects(HttpClient.Redirect.NEVER).connectTimeout(Duration.ofSeconds(5)).build();

    HttpResponse<String> request(URI uri) throws Exception {
      return client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(10)).GET().build(),
        HttpResponse.BodyHandlers.ofString());
    }

    HttpResponse<String> get(String path) throws Exception { return request(URI.create(base() + path)); }

    JsonNode session() throws Exception {
      HttpResponse<String> response = get("/api/session");
      assertThat(response.statusCode()).isEqualTo(200);
      return JSON.readTree(response.body());
    }

    HttpResponse<String> move(String action, String carrier, long version, String csrf) throws Exception {
      var request = HttpRequest.newBuilder(URI.create(base() + "/api/docks/D1/moves"))
        .timeout(Duration.ofSeconds(10)).header("Content-Type", "application/json")
        .header("Idempotency-Key", UUID.randomUUID().toString())
        .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(
          Map.of("action", action, "carrier", carrier, "expectedVersion", version))));
      if (csrf != null) request.header("X-CSRF-TOKEN", csrf);
      return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Override public void close() { client.close(); }
  }

  enum Fault { NONE, STATE, NONCE, SIGNATURE, EXPIRED }
  private record Login(String group, Fault fault) {}
  private record Grant(String redirect, String nonce, String challenge, Login login) {}

  /** Minimal confidential-client issuer with one-use, redirect-bound codes. */
  private static final class Issuer implements AutoCloseable {
    private final HttpServer server;
    private final ExecutorService executor;
    private final RSAKey key;
    private final RSAKey wrongKey;
    private final Map<String, Grant> codes = new ConcurrentHashMap<>();
    final AtomicReference<Login> next = new AtomicReference<>(new Login(OPERATORS, Fault.NONE));
    final AtomicReference<Throwable> failure = new AtomicReference<>();
    final AtomicReference<Instant> lastExpiration = new AtomicReference<>();
    final AtomicInteger discoveryRequests = new AtomicInteger();
    final AtomicInteger keyRequests = new AtomicInteger();
    final AtomicInteger tokenRequests = new AtomicInteger();

    static Issuer start() {
      try { return new Issuer(); }
      catch (Exception error) { throw new ExceptionInInitializerError(error); }
    }

    private Issuer() throws Exception {
      key = new RSAKeyGenerator(2048).keyID("local-rsa").keyUse(KeyUse.SIGNATURE).generate();
      wrongKey = new RSAKeyGenerator(2048).keyID("local-rsa").generate();
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      executor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "oidc-protocol-fixture");
        thread.setDaemon(true);
        return thread;
      });
      server.setExecutor(executor);
      server.createContext("/", this::handle);
      server.start();
    }

    String base() { return "http://127.0.0.1:" + server.getAddress().getPort(); }

    private void handle(HttpExchange exchange) throws IOException {
      try {
        switch (exchange.getRequestURI().getPath()) {
          case "/.well-known/openid-configuration" -> {
            discoveryRequests.incrementAndGet();
            json(exchange, 200, Map.of(
              "issuer", base(), "authorization_endpoint", base() + "/authorize",
              "token_endpoint", base() + "/token", "jwks_uri", base() + "/jwks",
              "response_types_supported", List.of("code"), "subject_types_supported", List.of("public"),
              "id_token_signing_alg_values_supported", List.of("RS256"),
              "token_endpoint_auth_methods_supported", List.of("client_secret_basic"),
              "scopes_supported", List.of("openid", "profile")));
          }
          case "/jwks" -> {
            keyRequests.incrementAndGet();
            json(exchange, 200, new JWKSet(key.toPublicJWK()).toJSONObject());
          }
          case "/authorize" -> authorize(exchange);
          case "/token" -> token(exchange);
          default -> json(exchange, 404, Map.of("error", "not_found"));
        }
      } catch (Exception error) {
        failure.compareAndSet(null, error);
        json(exchange, 500, Map.of("error", "fixture_failure"));
      } finally {
        exchange.close();
      }
    }

    private void authorize(HttpExchange exchange) throws IOException {
      Map<String, String> query = form(exchange.getRequestURI().getRawQuery());
      if (!CLIENT.equals(query.get("client_id")) || !"code".equals(query.get("response_type"))
          || query.get("state") == null || query.get("nonce") == null) {
        json(exchange, 400, Map.of("error", "invalid_request"));
        return;
      }
      Login login = next.getAndSet(new Login(OPERATORS, Fault.NONE));
      String code = UUID.randomUUID().toString();
      codes.put(code, new Grant(query.get("redirect_uri"), query.get("nonce"), query.get("code_challenge"), login));
      String state = login.fault() == Fault.STATE ? "tampered-state" : query.get("state");
      exchange.getResponseHeaders().set("Location", query.get("redirect_uri") + "?code=" + encode(code) + "&state=" + encode(state));
      exchange.sendResponseHeaders(302, -1);
    }

    private void token(HttpExchange exchange) throws Exception {
      tokenRequests.incrementAndGet();
      String basic = "Basic " + Base64.getEncoder().encodeToString((CLIENT + ":" + SECRET).getBytes(StandardCharsets.UTF_8));
      if (!"POST".equals(exchange.getRequestMethod()) || !basic.equals(exchange.getRequestHeaders().getFirst("Authorization"))) {
        json(exchange, 401, Map.of("error", "invalid_client"));
        return;
      }
      Map<String, String> body = form(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
      Grant grant = codes.remove(body.getOrDefault("code", ""));
      if (grant == null || !"authorization_code".equals(body.get("grant_type")) || !grant.redirect().equals(body.get("redirect_uri"))) {
        json(exchange, 400, Map.of("error", "invalid_grant"));
        return;
      }
      if (grant.challenge() != null) {
        String proof = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256")
          .digest(body.getOrDefault("code_verifier", "").getBytes(StandardCharsets.US_ASCII)));
        if (!grant.challenge().equals(proof)) {
          json(exchange, 400, Map.of("error", "invalid_grant"));
          return;
        }
      }
      Instant now = Instant.now();
      boolean expired = grant.login().fault() == Fault.EXPIRED;
      Instant issued = expired ? now.minusSeconds(600) : now;
      Instant expiration = expired ? now.minusSeconds(300) : now.plusSeconds(600);
      lastExpiration.set(expiration);
      // Echo the nonce from the authorization request. Spring sends its hashed
      // nonce on the wire and compares that claim when completing the login.
      // Protocol handling: spring-security 6.5.8, OidcAuthorizationCodeAuthenticationProvider.validateNonce.
      JWTClaimsSet claims = new JWTClaimsSet.Builder().issuer(base()).subject(SUBJECT).audience(CLIENT)
        .issueTime(Date.from(issued)).expirationTime(Date.from(expiration))
        .claim("nonce", grant.login().fault() == Fault.NONCE ? "invalid-nonce" : grant.nonce())
        .claim("groups", List.of(grant.login().group())).build();
      SignedJWT token = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256)
        .type(JOSEObjectType.JWT).keyID(key.getKeyID()).build(), claims);
      // Same key ID, different private key: this exercises signature checking,
      // rather than merely rejecting a key ID missing from the public key set.
      token.sign(new RSASSASigner(grant.login().fault() == Fault.SIGNATURE ? wrongKey : key));
      json(exchange, 200, Map.of("access_token", UUID.randomUUID().toString(), "token_type", "Bearer",
        "expires_in", 600, "scope", "openid profile", "id_token", token.serialize()));
    }

    private static void json(HttpExchange exchange, int status, Object body) throws IOException {
      byte[] bytes = JSON.writeValueAsBytes(body);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.getResponseHeaders().set("Cache-Control", "no-store");
      exchange.sendResponseHeaders(status, bytes.length);
      exchange.getResponseBody().write(bytes);
    }

    @Override public void close() {
      server.stop(0);
      executor.shutdownNow();
    }
  }

  private static Map<String, String> form(String encoded) {
    Map<String, String> fields = new LinkedHashMap<>();
    if (encoded != null && !encoded.isBlank()) for (String pair : encoded.split("&")) {
      String[] parts = pair.split("=", 2);
      fields.put(URLDecoder.decode(parts[0], StandardCharsets.UTF_8),
        URLDecoder.decode(parts.length == 2 ? parts[1] : "", StandardCharsets.UTF_8));
    }
    return fields;
  }

  private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
}
