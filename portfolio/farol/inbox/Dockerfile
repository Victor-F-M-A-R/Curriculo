FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish -c Release -o /out
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out/ ./
RUN mkdir /data && chown $APP_UID /data
ENV ASPNETCORE_URLS=http://+:8084 INBOX_CONNECTION="Data Source=/data/inbox.db"
USER $APP_UID
EXPOSE 8084
ENTRYPOINT ["dotnet","Inbox.dll"]
