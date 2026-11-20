package br.dev.docanorte;

import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.client.registration.*;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@WebMvcTest(value = YardController.class, properties = {
  "OIDC_CLIENT_ID=yard-test", "OIDC_CLIENT_SECRET=local-fixture",
  "OIDC_ISSUER=https://identity.example.test", "yard.operator-group=yard-operators",
  "yard.reader-token=reader-fixture-for-internal-qa-only"
})
@ActiveProfiles("oidc")
@Import({Access.class, OidcRolesTest.TestClient.class})
class OidcRolesTest {
  @TestConfiguration(proxyBeanMethods = false)
  static class TestClient {
    @Bean
    ClientRegistrationRepository registrations() {
      var client = ClientRegistration.withRegistrationId("yard")
        .clientId("yard-test").clientSecret("local-fixture")
        .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
        .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}").scope("openid")
        .authorizationUri("https://identity.example.test/authorize")
        .tokenUri("https://identity.example.test/token")
        .jwkSetUri("https://identity.example.test/keys")
        .build();
      return new InMemoryClientRegistrationRepository(client);
    }
  }

  @Autowired MockMvc mvc;
  @MockitoBean Yard yard;

  private RequestPostProcessor memberOf(String group) {
    return oidcLogin().idToken(token -> token.claim("sub", "turno-A").claim("groups", List.of(group))
      .issuedAt(java.time.Instant.now().minusSeconds(1)).expiresAt(java.time.Instant.now().plusSeconds(300)));
  }

  @Test
  void expiredIdentityCannotKeepItsWritePermission() throws Exception {
    var expired = oidcLogin().idToken(token -> token.subject("expired-operator")
      .claim("groups", List.of("yard-operators"))
      .issuedAt(java.time.Instant.now().minusSeconds(600)).expiresAt(java.time.Instant.now().minusSeconds(1)));
    mvc.perform(get("/api/session").with(expired)).andExpect(status().isOk())
      .andExpect(jsonPath("$.canWrite").value(false));
    mvc.perform(post("/api/docks/D1/moves").with(expired).with(csrf())
      .header("Idempotency-Key", UUID.randomUUID()).contentType("application/json")
      .content("{\"action\":\"book\",\"carrier\":\"Denied\",\"expectedVersion\":0}"))
      .andExpect(status().isForbidden());
    verifyNoInteractions(yard);
  }

  @Test
  void oldRolesRequireReauthenticationEvenWithLongLivedToken() throws Exception {
    var old = oidcLogin().idToken(token -> token.subject("operator")
      .claim("groups", List.of("yard-operators"))
      .issuedAt(java.time.Instant.now().minusSeconds(601)).expiresAt(java.time.Instant.now().plusSeconds(3600)));
    mvc.perform(get("/api/session").with(old)).andExpect(status().isOk())
      .andExpect(jsonPath("$.canWrite").value(false));
    verifyNoInteractions(yard);
  }

  @Test
  void operationalDataRequiresIdentityInFederatedMode() throws Exception {
    mvc.perform(get("/api/yard")).andExpect(status().isUnauthorized());
    verifyNoInteractions(yard);
    mvc.perform(get("/api/yard").with(memberOf("yard-readers"))).andExpect(status().isOk());
    verify(yard).snapshot();
  }

  @Test
  void portariaTokenReadsButCannotGrantWritePrivileges() throws Exception {
    mvc.perform(get("/api/yard").header("X-Yard-Reader", "invalid")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/yard").header("X-Yard-Reader", "reader-fixture-for-internal-qa-only"))
      .andExpect(status().isOk());
    mvc.perform(post("/api/docks/D1/moves").with(csrf())
      .header("X-Yard-Reader", "reader-fixture-for-internal-qa-only")
      .header("Idempotency-Key", UUID.randomUUID()).contentType("application/json")
      .content("{\"action\":\"book\",\"carrier\":\"Denied\",\"expectedVersion\":0}"))
      .andExpect(status().isForbidden());
    verify(yard).snapshot();
    verifyNoMoreInteractions(yard);
  }

  @Test
  void readerAndOperatorHaveDifferentSessionAndMovePermissions() throws Exception {
    var key = UUID.randomUUID();
    var path = "/api/docks/D1/moves";
    var body = "{\"action\":\"book\",\"carrier\":\"Aurora\",\"expectedVersion\":0}";

    mvc.perform(get("/api/session").with(memberOf("yard-readers")))
      .andExpect(status().isOk()).andExpect(jsonPath("$.federated").value(true))
      .andExpect(jsonPath("$.canWrite").value(false));
    mvc.perform(post(path).with(memberOf("yard-readers")).with(csrf())
        .header("Idempotency-Key", key).contentType("application/json").content(body))
      .andExpect(status().isForbidden());
    verifyNoInteractions(yard);

    mvc.perform(get("/api/session").with(memberOf("yard-operators")))
      .andExpect(status().isOk()).andExpect(jsonPath("$.canWrite").value(true));
    mvc.perform(post(path).with(memberOf("yard-operators")).with(csrf())
        .header("Idempotency-Key", key).contentType("application/json").content(body))
      .andExpect(status().isOk());
    verify(yard).apply("D1", key, new Yard.Command("book", "Aurora", 0), "turno-A");
  }
}
