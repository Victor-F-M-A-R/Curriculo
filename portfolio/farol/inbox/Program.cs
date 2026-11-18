using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;
var secret = config["INBOX_TOKEN"];
if (string.IsNullOrWhiteSpace(secret))
    throw new InvalidOperationException("Configure INBOX_TOKEN.");
bool sqlserver = string.Equals(
    config["INBOX_ENGINE"],
    "sqlserver",
    StringComparison.OrdinalIgnoreCase
);
DbConnection Open()
{
    DbConnection db = sqlserver
        ? new SqlConnection(
            config["INBOX_CONNECTION"]
                ?? throw new InvalidOperationException("INBOX_CONNECTION requerido.")
        )
        : new SqliteConnection(config["INBOX_CONNECTION"] ?? "Data Source=inbox.db");
    db.Open();
    return db;
}
using (var db = Open())
{
    var prefix = sqlserver
        ? "if object_id(N'review_inbox',N'U') is null create table review_inbox"
        : "create table if not exists review_inbox";
    db.Execute(
        prefix
            + " (event_id varchar(32) primary key,run_id varchar(32) not null, received_at varchar(40) not null)"
    );
}
var app = builder.Build();
app.MapGet("/health", () => new { status = "ok" });
app.MapPost("/events", (InboxEvent body, HttpRequest req) =>
{
    var supplied = req.Headers["X-Inbox-Token"].ToString();
    if (
        !CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(supplied)),
            SHA256.HashData(Encoding.UTF8.GetBytes(secret))
        )
    )
        return Results.Unauthorized();
    if (
        body.kind != "review.requested"
        || !Guid.TryParseExact(body.event_id, "N", out _)
        || !Guid.TryParseExact(body.run_id, "N", out _)
    )
        return Results.BadRequest(new { detail = "Envelope inválido." });
    using var db = Open();
    try
    {
        db.Execute(
            "insert into review_inbox(event_id,run_id,received_at) values(@event_id,@run_id,@stamp)",
            new
            {
                body.event_id,
                body.run_id,
                stamp = DateTimeOffset.UtcNow.ToString("O"),
            }
        );
    }
    catch (DbException e)
        when (e is SqliteException { SqliteErrorCode: 19 }
            || e is SqlException { Number: 2601 or 2627 }
        )
    {
        string existing = db.QuerySingle<string>(
            "select run_id from review_inbox where event_id=@event_id",
            new { body.event_id }
        );
        if (existing != body.run_id)
            return Results.Conflict(new { detail = "Evento usado por outra consulta." });
    }
    return Results.Ok(new { event_id = body.event_id });
});
app.Run();

record InboxEvent(string event_id, string run_id, string kind);
