FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY . .
RUN mvn -B -ntp package
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/gate-reader-1.0.0.jar app.jar
ENV BIND_ADDRESS=0.0.0.0
USER 10001:10001
EXPOSE 8085
ENTRYPOINT ["java","-jar","app.jar"]
