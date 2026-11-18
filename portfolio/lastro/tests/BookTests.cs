using Lastro;
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
}
