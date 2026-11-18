using Lastro;
using Dapper;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace LastroTests;

public class BookTests : IDisposable
{
    readonly string path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".db");
    readonly Book book;
    readonly string desk;

    public BookTests()
    {
        var settings = new Dictionary<string, string?>
        {
            ["BOOK_ENGINE"] = Environment.GetEnvironmentVariable("TEST_BOOK_ENGINE") ?? "sqlite",
            ["BOOK_CONNECTION"] = Environment.GetEnvironmentVariable("TEST_BOOK_CONNECTION")
                ?? $"Data Source={path};Pooling=False",
        };
        book = new Book(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
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
}
