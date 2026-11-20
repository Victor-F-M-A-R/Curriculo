using Lastro;
using Dapper;
using Microsoft.Extensions.Configuration;
using Xunit;
using System.Data.Common;
using System.Diagnostics;

namespace LastroTests;

public class BookTests : IDisposable
{
    readonly string path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".db");
    readonly Book book;
    readonly string desk;
    readonly IConfiguration configuration;

    public BookTests()
    {
        var settings = new Dictionary<string, string?>
        {
            ["BOOK_ENGINE"] = Environment.GetEnvironmentVariable("TEST_BOOK_ENGINE") ?? "sqlite",
            ["BOOK_CONNECTION"] = Environment.GetEnvironmentVariable("TEST_BOOK_CONNECTION")
                ?? $"Data Source={path};Pooling=False",
        };
        configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        book = new Book(configuration);
        book.Migrate();
        desk = book.Create();
    }

    public void Dispose()
    {
        if (File.Exists(path))
            File.Delete(path);
    }

    const string Head = "referencia;data;recebido\n";

    [Fact]
    public void ReplayKeepsTheSameLedger()
    {
        var csv = Head + "REP-1047;2026-11-16;710,00";
        Assert.False(book.Import(desk, csv).Replay);
        Assert.True(book.Import(desk, csv).Replay);
        Assert.Equal("matched", book.Entries(desk).Single(x => x.Reference == "REP-1047").Status);
        Assert.Single(book.Events(desk), x => x.Kind == "import");
    }

    [Fact]
    public void ConflictingLastRowRollsBackFirstRow()
    {
        var csv = Head + "REP-NEW;2026-11-16;10,10\nREP-1041;2026-11-16;88,88";
        Assert.Equal(409, Assert.Throws<DeskError>(() => book.Import(desk, csv)).Status);
        Assert.DoesNotContain(book.Entries(desk), x => x.Reference == "REP-NEW");
        Assert.DoesNotContain(book.Events(desk), x => x.Kind == "import");
    }

    [Fact]
    public void ReviewIsScopedAndPreservesTheAmount()
    {
        var before = book.Entries(desk).Single(x => x.Reference == "REP-1043");
        book.Review(desk, before.Reference, "Tarifa identificada no extrato.");
        var after = book.Entries(desk).Single(x => x.Reference == before.Reference);
        Assert.Equal(before.Delta, after.Delta);
        Assert.Equal("reviewed", after.Status);
        Assert.Throws<DeskError>(() => book.Review(desk, before.Reference, "Repetição do evento."));
        var other = book.Create();
        Assert.Equal(
            "disputed",
            book.Entries(other).Single(x => x.Reference == before.Reference).Status
        );
    }

    [Theory]
    [InlineData("A-1;2026-02-30;2,11")]
    [InlineData("A-1;2026-01-01;2.123")]
    [InlineData("A-1;2026-01-01;-0,01")]
    [InlineData("A-1;2026-01-01;2,123")]
    public void InvalidInputRejectsWholeBatch(string line) =>
        Assert.Throws<DeskError>(() => Batch.Parse(Head + line));

    [Fact]
    public void OrphanReceiptCanBeExplained()
    {
        book.Import(desk, Head + "REP-X;2026-11-16;45,17");
        var row = book.Entries(desk).Single(x => x.Reference == "REP-X");
        Assert.Null(row.Expected);
        Assert.Equal(4517, row.Received);
        Assert.Equal("orphan", row.Status);
    }

    [Fact]
    public void AuditHonorsWorkspaceFiltersAndOrderWhenTimestampsTie()
    {
        string other = book.Create();
        book.Review(other, "REP-1043", "Revisão da outra mesa.");
        book.Review(desk, "REP-1043", "Revisão da mesa selecionada.");
        for (int i = 0; i < Book.AuditPageSize; i++)
            book.Import(desk, Head + $"PAG-{i:D2};2026-11-17;1,00");

        // Imports can share the same clock tick. The event ID is the cursor's tiebreaker.
        using var db = book.Open();
        db.Execute("update events set stamp=@stamp where workspace=@desk",
            new { desk, stamp = "2026-11-17T12:00:00.0000000+00:00" });
        var first = book.BrowseEvents(desk);
        Assert.Equal(Book.AuditPageSize, first.Events.Count);
        Assert.True(first.HasMore);
        var last = first.Events[^1];
        var next = book.BrowseEvents(desk, beforeStamp: last.Stamp, beforeId: last.Id);
        Assert.False(next.HasMore);
        Assert.Equal(2, next.Events.Count);
        var ids = first.Events.Concat(next.Events).Select(ev => ev.Id).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.Equal(ids.OrderByDescending(id => id, StringComparer.Ordinal), ids);

        var review = Assert.Single(book.BrowseEvents(desk, "review", "rep-1043").Events);
        Assert.Equal("Revisão da mesa selecionada.", review.Detail);
        Assert.Empty(book.BrowseEvents(desk, "import", "REP-1043").Events);
    }

    [Fact]
    public void CsvSizeIsMeasuredInUtf8Bytes()
    {
        string input = Head + new string('é', 50_000);
        Assert.Contains("100 KB", Assert.Throws<DeskError>(() => Batch.Parse(input)).Message);
    }

    [Fact]
    public async Task ConcurrentReplaysCreateOneBatchAndEvent()
    {
        const string csv = Head + "RACE-01;2026-11-20;99,99";
        using var ready = new ManualResetEventSlim();
        var calls = Enumerable.Range(0, 4).Select(_ => Task.Run(() => {
            ready.Wait(); return book.Import(desk, csv);
        })).ToArray();
        ready.Set();
        var results = await Task.WhenAll(calls);
        Assert.Single(results, result => !result.Replay);
        Assert.Equal(3, results.Count(result => result.Replay));
        Assert.Single(book.Entries(desk), row => row.Reference == "RACE-01");
        Assert.Single(book.Events(desk), ev => ev.Kind == "import");
    }

    [Fact]
    public async Task OverlappingConcurrentBatchesNeverLeavePartialReceipts()
    {
        using var ready = new ManualResetEventSlim();
        var calls = new[] { "LEFT", "RIGHT" }.Select(side => Task.Run(() => {
            ready.Wait();
            try { book.Import(desk, Head + $"{side}-01;2026-11-20;1,00\nSHARED-01;2026-11-20;2,00"); return (side, ok: true); }
            catch (DeskError error) { Assert.Equal(409, error.Status); return (side, ok: false); }
        })).ToArray();
        ready.Set();
        var outcomes = await Task.WhenAll(calls);
        var winner = Assert.Single(outcomes, result => result.ok).side;
        var loser = Assert.Single(outcomes, result => !result.ok).side;
        var rows = book.Entries(desk);
        Assert.Contains(rows, row => row.Reference == winner + "-01");
        Assert.DoesNotContain(rows, row => row.Reference == loser + "-01");
        Assert.Single(book.Events(desk), ev => ev.Kind == "import");
        Assert.False(book.Import(desk, Head + $"{loser}-01;2026-11-20;1,00").Replay);
    }

    [Fact]
    public async Task ConcurrentReviewsKeepOneReasonAndOneEvent()
    {
        using var ready = new ManualResetEventSlim();
        var calls = Enumerable.Range(0, 3).Select(number => Task.Run(() => {
            ready.Wait();
            try { book.Review(desk, "REP-1043", $"Revisão concorrente {number}."); return true; }
            catch (DeskError error) { Assert.Equal(409, error.Status); return false; }
        })).ToArray();
        ready.Set();
        Assert.Single(await Task.WhenAll(calls), ok => ok);
        var entry = book.Entries(desk).Single(row => row.Reference == "REP-1043");
        Assert.Equal(entry.Reason, Assert.Single(book.Events(desk), ev => ev.Kind == "review").Detail);
        Assert.Equal(-3000, entry.Delta);
    }

    [Fact]
    public void LockTimeoutRollsBackAndCanRecoverWithSameBatch()
    {
        const string csv = Head + "LOCK-01;2026-11-20;0,01";
        using var db = book.Open();
        using var tx = db.BeginTransaction();
        db.Execute("insert into receipts values(@desk,'LOCK-01',1,'2026-11-20')", new { desk }, tx);
        var watch = Stopwatch.StartNew();
        Assert.ThrowsAny<DbException>(() => book.Import(desk, csv));
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(12), "DB wait must finish before the client confirmation deadline.");
        tx.Rollback();
        Assert.DoesNotContain(book.Events(desk), ev => ev.Kind == "import");
        Assert.False(book.Import(desk, csv).Replay);
        Assert.True(book.Import(desk, csv).Replay);
        Assert.Single(book.Events(desk), ev => ev.Kind == "import");
    }

    [Fact]
    public void RestartPreservesAccountReceiptsAndReviews()
    {
        var user = "qa-" + Guid.NewGuid().ToString("N")[..20];
        var workspace = book.Create(user, "synthetic-test-hash");
        var csv = Head + "PERSIST-01;2026-11-20;999999999,99";
        book.Import(workspace, csv);
        book.Review(workspace, "PERSIST-01", "Revisão preservada após reabrir.");
        var restarted = new Book(configuration);
        restarted.Migrate();
        Assert.Equal(workspace, restarted.Account(user)!.Value.Workspace);
        Assert.True(restarted.Import(workspace, csv).Replay);
        var receipt = restarted.Entries(workspace).Single(row => row.Reference == "PERSIST-01");
        Assert.Equal(99_999_999_999L, receipt.Received);
        Assert.Equal("reviewed", receipt.Status);
        Assert.Equal(3, restarted.Events(workspace).Count);
    }

    [Fact]
    public void NewEventsBetweenPagesDoNotRepeatOrHideOlderEvents()
    {
        for (int i = 0; i < Book.AuditPageSize + 3; i++)
            book.Import(desk, Head + $"CURSOR-{i};2026-11-20;0,01");
        var before = book.Events(desk).Select(ev => ev.Id).ToHashSet();
        var first = book.BrowseEvents(desk);
        book.Review(desk, "REP-1043", "Evento novo entre duas páginas.");
        var last = first.Events[^1];
        var next = book.BrowseEvents(desk, beforeStamp: last.Stamp, beforeId: last.Id);
        var traversed = first.Events.Concat(next.Events).Select(ev => ev.Id).ToList();
        Assert.Equal(before.Count, traversed.Count);
        Assert.True(before.SetEquals(traversed));
        Assert.Equal("review", book.BrowseEvents(desk).Events[0].Kind);
        Assert.Empty(book.BrowseEvents(book.Create(), "review").Events);
    }
}
