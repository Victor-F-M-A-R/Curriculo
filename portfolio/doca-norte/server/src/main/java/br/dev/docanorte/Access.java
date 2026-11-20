package br.dev.docanorte;

import java.util.Arrays;
import java.util.List;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
class Access {

  private final boolean federated;
  private final String operatorGroup;
  @Value("${yard.auth-max-age-seconds:300}")
  private long maxAuthorizationAge = 300;
  @Value("${yard.reader-token:}")
  private String readerToken = "";

  Access(
    Environment env,
    @Value("${yard.operator-group:yard-operators}") String group
  ) {
    federated = Arrays.asList(env.getActiveProfiles()).contains("oidc");
    operatorGroup = group;
  }

  @Bean
  SecurityFilterChain security(HttpSecurity http) throws Exception {
    // CSRF remains enabled. The same-origin UI obtains a session-bound token.
    http.authorizeHttpRequests(auth ->
      auth
        .requestMatchers("/actuator/prometheus")
        .access((subject, context) ->
          new org.springframework.security.authorization.AuthorizationDecision(
            !federated || mayWrite(subject.get())
          )
        )
        .anyRequest()
        .permitAll()
    );
    if (federated) http.oauth2Login(login ->
      login.defaultSuccessUrl("/", true)
    );
    return http.build();
  }

  boolean mayWrite(Authentication auth) {
    if (!federated) return true;
    if (!currentIdentity(auth)) return false;
    OidcUser user = (OidcUser) auth.getPrincipal();
    List<String> groups = user.getClaimAsStringList("groups");
    return groups != null && groups.contains(operatorGroup);
  }

  boolean currentIdentity(Authentication auth) {
    if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof OidcUser user)) return false;
    var token = user.getIdToken();
    if (token == null || token.getIssuedAt() == null || token.getExpiresAt() == null) return false;
    var now = Instant.now();
    return token.getExpiresAt().isAfter(now) && !token.getIssuedAt().isAfter(now.plusSeconds(30))
      && Duration.between(token.getIssuedAt(), now).getSeconds() < Math.max(1, maxAuthorizationAge)
      && user.getSubject() != null && user.getSubject().length() <= 255;
  }

  boolean mayRead(Authentication auth, String token) {
    if (!federated || currentIdentity(auth)) return true;
    return !readerToken.isBlank() && token != null && MessageDigest.isEqual(
      readerToken.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8));
  }

  String name(Authentication auth) {
    if (!federated) return "Plantão demo";
    return currentIdentity(auth) && auth.getPrincipal() instanceof OidcUser user
      ? user.getSubject()
      : "Visitante";
  }

  boolean federated() {
    return federated;
  }
}
