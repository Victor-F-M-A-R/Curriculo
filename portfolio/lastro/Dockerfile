FROM node:24-bookworm-slim AS ui
WORKDIR /src
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY server/ ./
COPY --from=ui /src/dist/ wwwroot/
RUN dotnet publish -c Release -o /out
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out/ ./
ENV ASPNETCORE_URLS=http://+:8082
RUN mkdir -p /home/app/.aspnet/DataProtection-Keys && chown -R "$APP_UID" /home/app/.aspnet
ENV HOME=/home/app
USER $APP_UID
EXPOSE 8082
ENTRYPOINT ["dotnet","Lastro.dll"]
