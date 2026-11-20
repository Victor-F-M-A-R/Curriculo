using System.Data.Common;
using System.Diagnostics;
using Dapper;
using FarolInbox;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace InboxTests;

public sealed class StoreTests : IAsyncLifetime {
    readonly string path = Path.Combine(Path.GetTempPath(), "inbox-" + Guid.NewGuid() + ".db");
    readonly string engine = Environment.GetEnvironmentVariable("TEST_INBOX_ENGINE") ?? "sqlite";
    readonly IConfiguration config;
    readonly InboxStore store;
    readonly string connection;
    readonly string id = Guid.NewGuid().ToString("N");
    readonly string run = Guid.NewGuid().ToString("N");

    public StoreTests() {
        connection = Environment.GetEnvironmentVariable("TEST_INBOX_CONNECTION") ?? $"Data Source={path};Pooling=False";
        config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["INBOX_ENGINE"] = engine, ["INBOX_CONNECTION"] = connection,
        }).Build();
        store = new InboxStore(config);
    }
    public Task InitializeAsync() => store.MigrateAsync();
    public Task DisposeAsync() { if (File.Exists(path)) File.Delete(path); return Task.CompletedTask; }
    DbConnection Open() { DbConnection db = engine == "sqlserver" ? new SqlConnection(connection) : new SqliteConnection(connection); db.Open(); return db; }
    InboxEvent Envelope(string? eventId = null, string? runId = null, string kind = "review.requested") => new(eventId ?? id, runId ?? run, kind);
    int Count() { using var db = Open(); return db.ExecuteScalar<int>("select count(*) from review_inbox where lower(event_id)=@id", new { id }); }

    [Fact]
    public async Task CanonicalReplaySurvivesRestartWithoutChangingTimestamp() {
        Assert.Equal(id, await store.ReceiveAsync(Envelope(id.ToUpperInvariant(), run.ToUpperInvariant())));
        using var db = Open();
        var stamp = db.QuerySingle<string>("select received_at from review_inbox where event_id=@id", new { id });
        var restarted = new InboxStore(config);
        await restarted.MigrateAsync();
        Assert.Equal(id, await restarted.ReceiveAsync(Envelope()));
        Assert.Equal(stamp, db.QuerySingle<string>("select received_at from review_inbox where event_id=@id", new { id }));
        Assert.Equal(1, Count());
    }

    [Fact]
    public async Task LegacyUppercaseRowIsPreservedAndAcknowledged() {
        using var db = Open();
        var legacyId = id.ToUpperInvariant();
        db.Execute("insert into review_inbox values(@legacyId,@legacyRun,@stamp)", new {
            legacyId, legacyRun = run.ToUpperInvariant(), stamp = "2026-11-18T00:00:00.0000000+00:00",
        });
        Assert.Equal(id, await store.ReceiveAsync(Envelope()));
        Assert.Equal(1, Count());
        Assert.Equal(legacyId, db.QuerySingle<string>("select event_id from review_inbox where lower(event_id)=@id", new { id }));
    }

    [Fact]
    public async Task DifferentRunOrKindNeverReceivesReplayAcknowledgment() {
        await store.ReceiveAsync(Envelope());
        Assert.Equal(409, (await Assert.ThrowsAsync<InboxError>(() => store.ReceiveAsync(Envelope(runId: Guid.NewGuid().ToString("N"))))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<InboxError>(() => store.ReceiveAsync(Envelope(kind: "review.cancelled")))).Status);
        Assert.Equal(1, Count());
    }

    [Fact]
    public async Task SimultaneousCaseVariantsPersistOneEvent() {
        using var ready = new ManualResetEventSlim();
        var calls = Enumerable.Range(0, 4).Select(i => Task.Run(async () => {
            ready.Wait();
            return await store.ReceiveAsync(i % 2 == 0 ? Envelope() : Envelope(id.ToUpperInvariant(), run.ToUpperInvariant()));
        })).ToArray();
        ready.Set();
        Assert.All(await Task.WhenAll(calls), result => Assert.Equal(id, result));
        Assert.Equal(1, Count());
    }

    [Fact]
    public async Task ConflictingConcurrentEventsHaveOneWinner() {
        using var ready = new ManualResetEventSlim();
        var calls = new[] { run, Guid.NewGuid().ToString("N") }.Select(runId => Task.Run(async () => {
            ready.Wait();
            try { await store.ReceiveAsync(Envelope(runId: runId)); return true; }
            catch (InboxError error) { Assert.Equal(409, error.Status); return false; }
        })).ToArray();
        ready.Set();
        Assert.Single(await Task.WhenAll(calls), ok => ok);
        Assert.Equal(1, Count());
    }

    [Theory]
    [InlineData("bad-id", "review.requested")]
    [InlineData("00000000-0000-0000-0000-000000000000", "review.requested")]
    [InlineData("00000000000000000000000000000000", "unknown")]
    public async Task InvalidEnvelopeIsRejectedWithoutPersistence(string eventId, string kind) {
        Assert.Equal(400, (await Assert.ThrowsAsync<InboxError>(() => store.ReceiveAsync(Envelope(eventId, kind: kind)))).Status);
        Assert.Equal(0, Count());
    }

    [Fact]
    public async Task CancelledRequestCanBeRetriedWithSameIdentity() {
        using var stop = new CancellationTokenSource();
        stop.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => store.ReceiveAsync(Envelope(), stop.Token));
        Assert.Equal(0, Count());
        await store.ReceiveAsync(Envelope());
        Assert.Equal(1, Count());
    }

    [Fact]
    public async Task DatabaseLockTimesOutAndResendRecovers() {
        using var db = Open();
        using var tx = db.BeginTransaction();
        db.Execute("insert into review_inbox values(@id,@run,@stamp)", new { id, run, stamp = DateTimeOffset.UtcNow.ToString("O") }, tx);
        var watch = Stopwatch.StartNew();
        await Assert.ThrowsAnyAsync<DbException>(() => store.ReceiveAsync(Envelope()));
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(12));
        tx.Rollback();
        await store.ReceiveAsync(Envelope());
        Assert.Equal(1, Count());
    }
}
