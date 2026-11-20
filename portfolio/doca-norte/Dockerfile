FROM node:24-bookworm-slim AS web
WORKDIR /src
COPY web/package*.json ./
RUN npm ci --ignore-scripts
COPY web/ ./
RUN npm run build
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY server/ ./
COPY --from=web /src/dist/doca/browser/ src/main/resources/static/
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp package -DskipTests
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/yard-api-1.0.0.jar app.jar
USER 10001:10001
ENV BIND_ADDRESS=0.0.0.0 PORT=8081
EXPOSE 8081
ENTRYPOINT ["java","-jar","app.jar"]
