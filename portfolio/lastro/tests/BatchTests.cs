using System.Globalization;
using Lastro;
using Xunit;

namespace LastroTests;

public class BatchTests {
    const string Head = "referencia;data;recebido\n";

    [Theory]
    [InlineData("pt-BR")]
    [InlineData("en-US")]
    [InlineData("tr-TR")]
    public void BomCrLfAndMoneyAreCultureIndependent(string culture) {
        var previous = CultureInfo.CurrentCulture;
        try {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
            var plain = Head + "REP-01;2024-02-29;0,01\nREP-02;2026-01-01;999999999,99";
            var parsed = Batch.Parse("\uFEFF" + plain.Replace("\n", "\r\n") + "\r\n");
            Assert.Equal(Batch.Parse(plain).Fingerprint, parsed.Fingerprint);
            Assert.Equal(new[] { 1L, 99_999_999_999L }, parsed.Rows.Select(row => row.Received));
        } finally { CultureInfo.CurrentCulture = previous; }
    }

    [Fact]
    public void QuotesAndWhitespaceNormalizeFieldsWithoutRounding() {
        var parsed = Batch.Parse(Head + "\"rep-01\";\"2026-11-20\";\"000001,5\"");
        var row = Assert.Single(parsed.Rows);
        Assert.Equal("REP-01", row.Reference);
        Assert.Equal(150, row.Received);
    }

    [Fact]
    public void ExactlyFiveHundredRowsAcceptedAndFiveHundredOneRejected() {
        var rows = Enumerable.Range(0, 501).Select(i => $"ROW-{i};2026-11-20;0").ToArray();
        Assert.Equal(500, Batch.Parse(Head + string.Join('\n', rows.Take(500))).Rows.Count);
        Assert.Throws<DeskError>(() => Batch.Parse(Head + string.Join('\n', rows)));
    }

    [Theory]
    [InlineData("REP-01;2023-02-29;1,00")]
    [InlineData("REP-01;2026-11-20;1000000000")]
    [InlineData("REP-01;2026-11-20;1e3")]
    [InlineData("REP-01;2026-11-20;NaN")]
    [InlineData("REP-01;2026-11-20;1.000,00")]
    [InlineData("REP-01;2026-11-20;1,00;extra")]
    [InlineData("REP-01;2026-11-20;1,00\nrep-01;2026-11-20;1,00")]
    [InlineData("\"REP-01;2026-11-20;1,00")]
    [InlineData("REP-01;2026-11-20;١,٠٠")]
    public void MalformedRowsRejectWholeFile(string rows) => Assert.Throws<DeskError>(() => Batch.Parse(Head + rows));

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("referencia;data;recebido")]
    [InlineData("reference;date;amount\nREP-01;2026-11-20;1,00")]
    public void MissingOrUnknownSchemaIsRejected(string? csv) => Assert.Throws<DeskError>(() => Batch.Parse(csv));
}
