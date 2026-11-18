using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.VisualBasic.FileIO;

namespace Lastro;

public record Invoice(string Reference, string Merchant, long Expected, string Day);

public record Receipt(string Reference, string Day, long Received);

public record Entry(
    string Reference,
    string Merchant,
    long? Expected,
    long? Received,
    string Day,
    string? Reason
)
{
    public long Delta => (Received ?? 0) - (Expected ?? 0);
    public string Status =>
        Reason is not null ? "reviewed"
        : Expected is null ? "orphan"
        : Received is null ? "pending"
        : Expected == Received ? "matched"
        : "disputed";
}

public record Event(
    string Id,
    string Workspace,
    string Kind,
    string Ref,
    string Detail,
    string Stamp
);

public record AuditSlice(IReadOnlyList<Event> Events, bool HasMore);

public record Login(string User, string Password);

public record ImportRequest(string Csv);

public record ReviewRequest(string Note);

public sealed class DeskError(string message, int status = 400) : Exception(message)
{
    public int Status => status;
}

public static class Batch
{
    public static (string Fingerprint, List<Receipt> Rows) Parse(string? input)
    {
        if (string.IsNullOrWhiteSpace(input) || input.Length > 100_000 || Encoding.UTF8.GetByteCount(input) > 100_000)
            throw new DeskError("O arquivo deve ter entre 1 byte e 100 KB.");
        var canonical = input.TrimStart('\uFEFF').Replace("\r\n", "\n").Trim();
        using var reader = new TextFieldParser(new StringReader(canonical));
        reader.SetDelimiters(";");
        reader.HasFieldsEnclosedInQuotes = true;
        var rows = new List<Receipt>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        try
        {
            if (
                !(reader.ReadFields() ?? []).SequenceEqual(
                    new[] { "referencia", "data", "recebido" }
                )
            )
                throw new DeskError("Cabeçalho esperado: referencia;data;recebido.");
            while (!reader.EndOfData)
            {
                var fields = reader.ReadFields() ?? [];
                if (fields.Length != 3)
                    throw new DeskError($"Linha {rows.Count + 2}: são necessárias três colunas.");
                var id = fields[0].Trim().ToUpperInvariant();
                if (
                    !System.Text.RegularExpressions.Regex.IsMatch(id, "^[A-Z0-9][A-Z0-9-]{1,29}$")
                    || !seen.Add(id)
                )
                    throw new DeskError(
                        $"Linha {rows.Count + 2}: referência inválida ou duplicada."
                    );
                if (
                    !DateOnly.TryParseExact(
                        fields[1],
                        "yyyy-MM-dd",
                        CultureInfo.InvariantCulture,
                        DateTimeStyles.None,
                        out _
                    )
                )
                    throw new DeskError($"Linha {rows.Count + 2}: use a data AAAA-MM-DD.");
                if (
                    !System.Text.RegularExpressions.Regex.IsMatch(
                        fields[2],
                        @"^\d{1,9}(,\d{1,2})?$"
                    )
                    || !decimal.TryParse(
                        fields[2],
                        NumberStyles.AllowDecimalPoint,
                        CultureInfo.GetCultureInfo("pt-BR"),
                        out var value
                    )
                )
                    throw new DeskError(
                        $"Linha {rows.Count + 2}: valor deve usar vírgula e até dois decimais."
                    );
                rows.Add(new Receipt(id, fields[1], (long)(100 * value)));
                if (rows.Count > 500)
                    throw new DeskError("O limite é de 500 linhas por lote.");
            }
        }
        catch (MalformedLineException)
        {
            throw new DeskError("CSV com aspas ou delimitadores inválidos.");
        }
        if (rows.Count == 0)
            throw new DeskError("Inclua pelo menos uma linha de repasse.");
        return (Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))), rows);
    }
}
