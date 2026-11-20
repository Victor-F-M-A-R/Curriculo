package br.dev.docanorte;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

class AccessTest {

  @Test
  void federatedWritesRequireTheConfiguredGroup() {
    var env = new MockEnvironment();
    env.setActiveProfiles("oidc");
    var policy = new Access(env, "ops");
    var auth = mock(Authentication.class);
    var principal = mock(OidcUser.class);
    when(auth.getPrincipal()).thenReturn(principal);
    when(auth.isAuthenticated()).thenReturn(true);
    when(principal.getSubject()).thenReturn("operator");
    when(principal.getIdToken()).thenReturn(new org.springframework.security.oauth2.core.oidc.OidcIdToken(
      "fixture", java.time.Instant.now().minusSeconds(1), java.time.Instant.now().plusSeconds(300), java.util.Map.of("sub", "operator")));
    assertThat(policy.mayWrite(null)).isFalse();
    when(principal.getClaimAsStringList("groups")).thenReturn(
      List.of("reader")
    );
    assertThat(policy.mayWrite(auth)).isFalse();
    when(principal.getClaimAsStringList("groups")).thenReturn(List.of("ops"));
    assertThat(policy.mayWrite(auth)).isTrue();
  }
}
