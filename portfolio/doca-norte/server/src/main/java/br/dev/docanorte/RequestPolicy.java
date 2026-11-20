package br.dev.docanorte;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.type.LogicalType;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.filter.OncePerRequestFilter;

/** Keep transport limits separate from business validation and transaction handling. */
@Configuration
class RequestPolicy {
  static final int MAX_BODY_BYTES = 16 * 1024;

  @Bean
  Jackson2ObjectMapperBuilderCustomizer strictJson() {
    return builder -> builder
      .featuresToEnable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
        DeserializationFeature.FAIL_ON_TRAILING_TOKENS, DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
      .featuresToDisable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
      .postConfigurer(mapper -> {
        mapper.getFactory().configure(JsonParser.Feature.STRICT_DUPLICATE_DETECTION, true);
        mapper.getFactory().setStreamReadConstraints(StreamReadConstraints.builder()
          .maxNestingDepth(16).maxStringLength(4096).maxNumberLength(20).build());
        for (var shape : new CoercionInputShape[]{CoercionInputShape.Integer,
            CoercionInputShape.Float, CoercionInputShape.Boolean})
          mapper.coercionConfigFor(LogicalType.Textual).setCoercion(shape, CoercionAction.Fail);
        for (var shape : new CoercionInputShape[]{CoercionInputShape.String,
            CoercionInputShape.Float, CoercionInputShape.Boolean})
          mapper.coercionConfigFor(LogicalType.Integer).setCoercion(shape, CoercionAction.Fail);
      });
  }

  static class PayloadTooLarge extends IOException {}

  @Bean
  @Order(Ordered.HIGHEST_PRECEDENCE + 20)
  OncePerRequestFilter boundApiBody() {
    return new OncePerRequestFilter() {
      @Override
      protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
          FilterChain chain) throws ServletException, IOException {
        if (request.getRequestURI().startsWith("/api/")) response.setHeader("Cache-Control", "no-store");
        if (!request.getRequestURI().startsWith("/api/") || !request.getMethod().equals("POST")) {
          chain.doFilter(request, response);
          return;
        }
        if (request.getContentLengthLong() > MAX_BODY_BYTES) {
          response.setStatus(413);
          response.setContentType("application/json");
          response.getWriter().write("{\"detail\":\"O comando excede o limite de 16 KiB.\"}");
          return;
        }
        chain.doFilter(new HttpServletRequestWrapper(request) {
          private ServletInputStream limited;
          @Override public ServletInputStream getInputStream() throws IOException {
            if (limited == null) {
              var input = super.getInputStream();
              limited = new ServletInputStream() {
                int consumed;
                private void count(int size) throws IOException {
                  if (size > 0 && (consumed += size) > MAX_BODY_BYTES) throw new PayloadTooLarge();
                }
                @Override public int read() throws IOException {
                  int value = input.read(); count(value < 0 ? 0 : 1); return value;
                }
                @Override public int read(byte[] bytes, int offset, int length) throws IOException {
                  int value = input.read(bytes, offset, Math.min(length, MAX_BODY_BYTES - consumed + 1));
                  count(value); return value;
                }
                @Override public boolean isFinished() { return input.isFinished(); }
                @Override public boolean isReady() { return input.isReady(); }
                @Override public void setReadListener(ReadListener listener) { input.setReadListener(listener); }
                @Override public void close() throws IOException { input.close(); }
              };
            }
            return limited;
          }
          @Override public BufferedReader getReader() throws IOException {
            return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
          }
        }, response);
      }
    };
  }
}
