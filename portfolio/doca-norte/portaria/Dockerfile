FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY . .
ARG MAVEN_CENTRAL_FALLBACK=0
RUN --mount=type=cache,target=/root/.m2 set -eu; \
    case "$MAVEN_CENTRAL_FALLBACK" in \
      0) set -- ;; \
      1) printf '%s\n' '<settings><mirrors><mirror><id>central-official-alternate</id><url>https://repo1.maven.org/maven2</url><mirrorOf>central</mirrorOf></mirror></mirrors></settings>' > /tmp/maven-central.xml; \
         set -- -s /tmp/maven-central.xml ;; \
      *) echo 'Invalid Maven Central selection' >&2; exit 2 ;; \
    esac; \
    mvn -B -U -C -ntp "$@" package
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/gate-reader-1.0.0.jar app.jar
ENV BIND_ADDRESS=0.0.0.0
USER 10001:10001
EXPOSE 8085
ENTRYPOINT ["java","-jar","app.jar"]
