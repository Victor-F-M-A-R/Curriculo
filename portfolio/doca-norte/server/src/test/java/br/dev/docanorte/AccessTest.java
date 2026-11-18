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
    assertThat(policy.mayWrite(null)).isFalse();
    when(principal.getClaimAsStringList("groups")).thenReturn(
      List.of("reader")
    );
    assertThat(policy.mayWrite(auth)).isFalse();
    when(principal.getClaimAsStringList("groups")).thenReturn(List.of("ops"));
    assertThat(policy.mayWrite(auth)).isTrue();
  }
}
