using System.Data.Common;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;

namespace FarolInbox;

public record InboxEvent(string? event_id, string? run_id, string? kind);
public sealed class InboxError(string message, int status) : Exception(message) {
    public int Status => status;
}

public sealed class InboxStore(IConfiguration config) {
    public const int TimeoutSeconds = 5;
    private bool SqlServer => string.Equals(config["INBOX_ENGINE"], "sqlserver", StringComparison.OrdinalIgnoreCase);

    private async Task<DbConnection> OpenAsync(CancellationToken stop) {
        var engine = config["INBOX_ENGINE"];
        if (!string.IsNullOrEmpty(engine) && !SqlServer && !engine.Equals("sqlite", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("INBOX_ENGINE inválido.");
        DbConnection db = SqlServer
            ? new SqlConnection(new SqlConnectionStringBuilder(config["INBOX_CONNECTION"]
                ?? throw new InvalidOperationException("INBOX_CONNECTION requerido.")) { ConnectTimeout = TimeoutSeconds }.ConnectionString)
            : new SqliteConnection(new SqliteConnectionStringBuilder(config["INBOX_CONNECTION"]
                ?? "Data Source=inbox.db") { DefaultTimeout = TimeoutSeconds }.ConnectionString);
        try { await db.OpenAsync(stop); }
        catch { await db.DisposeAsync(); throw; }
        return db;
    }

    private static CommandDefinition Command(string sql, object? values = null, CancellationToken stop = default) =>
        new(sql, values, commandTimeout: TimeoutSeconds, cancellationToken: stop);

    public async Task MigrateAsync() {
        await using var db = await OpenAsync(default);
        var prefix = SqlServer ? "if object_id(N'review_inbox',N'U') is null create table review_inbox" : "create table if not exists review_inbox";
        await db.ExecuteAsync(Command(prefix + " (event_id varchar(32) primary key,run_id varchar(32) not null, received_at varchar(40) not null)"));
        if (!SqlServer)
            await db.ExecuteAsync(Command("create index if not exists ix_review_inbox_normalized on review_inbox(lower(event_id))"));
    }

    public async Task CheckHealthAsync(CancellationToken stop = default) {
        await using var db = await OpenAsync(stop);
        await db.ExecuteScalarAsync<int>(Command("select 1", stop: stop));
    }

    public async Task<string> ReceiveAsync(InboxEvent body, CancellationToken stop = default) {
        if (!Guid.TryParseExact(body.event_id, "N", out var eventId) || !Guid.TryParseExact(body.run_id, "N", out var runId))
            throw new InboxError("Envelope inválido.", 400);
        var id = eventId.ToString("N");
        var run = runId.ToString("N");
        stop.ThrowIfCancellationRequested();
        await using var db = await OpenAsync(stop);

        async Task<bool> ExistingAsync() {
            // Legacy rows may use uppercase GUIDs. Preserve them and compare semantic IDs.
            var existing = (await db.QueryAsync<string>(Command(
                "select run_id from review_inbox where lower(event_id)=@id", new { id }, stop))).ToList();
            if (existing.Count == 0) return false;
            if (body.kind != "review.requested" || existing.Any(value => !Guid.TryParseExact(value, "N", out var oldRun) || oldRun != runId))
                throw new InboxError("Evento usado por outra consulta ou tipo.", 409);
            return true;
        }

        if (await ExistingAsync()) return id;
        if (body.kind != "review.requested") throw new InboxError("Envelope inválido.", 400);
        try {
            await db.ExecuteAsync(Command("insert into review_inbox(event_id,run_id,received_at) values(@id,@run,@stamp)",
                new { id, run, stamp = DateTimeOffset.UtcNow.ToString("O") }, stop));
        }
        catch (DbException e) when (e is SqliteException { SqliteErrorCode: 19 } || e is SqlException { Number: 2601 or 2627 }) {
            if (!await ExistingAsync()) throw;
        }
        return id;
    }
}
