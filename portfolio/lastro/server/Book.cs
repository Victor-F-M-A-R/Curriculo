using System.Data;
using System.Data.Common;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;
using Npgsql;

namespace Lastro;

public sealed class Book(IConfiguration configuration)
{
    private string Engine => configuration["BOOK_ENGINE"]?.ToLowerInvariant() ?? "sqlite";

    public DbConnection Open()
    {
        var cs = configuration["BOOK_CONNECTION"];
        DbConnection db = Engine switch
        {
            "postgres" => new NpgsqlConnection(
                cs ?? throw new InvalidOperationException("BOOK_CONNECTION requerido.")
            ),
            "sqlserver" => new SqlConnection(
                cs ?? throw new InvalidOperationException("BOOK_CONNECTION requerido.")
            ),
            "sqlite" => new SqliteConnection(cs ?? "Data Source=lastro.db;Default Timeout=15"),
            _ => throw new InvalidOperationException("BOOK_ENGINE inválido."),
        };
        db.Open();
        return db;
    }

    public void Migrate()
    {
        using var db = Open();
        if (Engine == "sqlite")
            db.Execute("pragma journal_mode=WAL");
        var tables = new Dictionary<string, string>
        {
            ["accounts"] =
                "handle varchar(40) primary key, hash varchar(256) not null, workspace varchar(32) not null unique",
            ["invoices"] =
                "workspace varchar(32) not null, reference varchar(30) not null, merchant nvarchar(100) not null, expected bigint not null, day varchar(10) not null, primary key(workspace,reference)",
            ["receipts"] =
                "workspace varchar(32) not null, reference varchar(30) not null, received bigint not null, day varchar(10) not null, primary key(workspace,reference)",
            ["batches"] =
                "workspace varchar(32) not null, fingerprint varchar(64) not null, primary key(workspace,fingerprint)",
            ["reviews"] =
                "workspace varchar(32) not null, reference varchar(30) not null, reason nvarchar(500) not null, primary key(workspace,reference)",
            ["events"] =
                "id varchar(32) primary key, workspace varchar(32) not null, kind varchar(30) not null, ref varchar(64) not null, detail nvarchar(600) not null, stamp varchar(40) not null, exported integer not null",
        };
        foreach (var (name, columns) in tables)
        {
            var ddl = Engine == "postgres" ? columns.Replace("nvarchar", "varchar") : columns;
            var sql =
                Engine == "sqlserver"
                    ? $"if object_id(N'{name}', N'U') is null create table {name} ({ddl})"
                    : $"create table if not exists {name} ({ddl})";
            db.Execute(sql);
        }
    }

    public static bool UniqueViolation(DbException e) =>
        e is SqliteException { SqliteErrorCode: 19 }
        || e is PostgresException { SqlState: "23505" }
        || e is SqlException { Number: 2601 or 2627 };

    public string Create(string? handle = null, string? hash = null)
    {
        string w = Guid.NewGuid().ToString("N");
        using var db = Open();
        using var tx = db.BeginTransaction();
        if (handle is not null)
        {
            try
            {
                db.Execute(
                    "insert into accounts(handle,hash,workspace) values(@handle,@hash,@w)",
                    new
                    {
                        handle,
                        hash,
                        w,
                    },
                    tx
                );
            }
            catch (DbException e) when (UniqueViolation(e))
            {
                throw new DeskError("Nome de acesso indisponível.", 409);
            }
        }
        Invoice[] seed =
        [
            new("REP-1041", "Estúdio Maré", 182450, "2026-11-12"),
            new("REP-1042", "Oficina Leste", 368900, "2026-11-12"),
            new("REP-1043", "Casa Botânica", 124800, "2026-11-13"),
            new("REP-1044", "Coletivo Grão", 247500, "2026-11-13"),
            new("REP-1045", "Ateliê Cedro", 98000, "2026-11-14"),
            new("REP-1046", "Moinho Aurora", 561240, "2026-11-14"),
            new("REP-1047", "Vila Papel", 71000, "2026-11-15"),
            new("REP-1048", "Forma Oficina", 196750, "2026-11-16"),
        ];
        foreach (var item in seed)
            db.Execute(
                "insert into invoices values(@w,@Reference,@Merchant,@Expected,@Day)",
                new
                {
                    w,
                    item.Reference,
                    item.Merchant,
                    item.Expected,
                    item.Day,
                },
                tx
            );
        foreach (var item in seed.Take(6))
        {
            var received = item.Reference switch
            {
                "REP-1043" => 121800L,
                "REP-1045" => 100500L,
                _ => item.Expected,
            };
            db.Execute(
                "insert into receipts values(@w,@Reference,@received,@Day)",
                new
                {
                    w,
                    item.Reference,
                    received,
                    item.Day,
                },
                tx
            );
        }
        Append(
            db,
            tx,
            w,
            "opened",
            "NOV-26",
            "Mesa de demonstração aberta com oito títulos sintéticos."
        );
        tx.Commit();
        return w;
    }

    public (string Hash, string Workspace)? Account(string handle)
    {
        using var db = Open();
        return
            db.QuerySingleOrDefault<AccountRow>(
                "select hash as Hash, workspace as Workspace from accounts where handle=@handle",
                new { handle }
            )
                is { } a
            ? (a.Hash, a.Workspace)
            : null;
    }

    private record AccountRow(string Hash, string Workspace);

    public List<Entry> Entries(string w, DbConnection? connection = null, DbTransaction? tx = null)
    {
        using var owned = connection is null ? Open() : null;
        var db = connection ?? owned!;
        return db.Query<Entry>(
                """
                select i.reference as Reference,i.merchant as Merchant,i.expected as Expected,r.received as Received,
                       i.day as Day,v.reason as Reason from invoices i
                left join receipts r on i.workspace=r.workspace and i.reference=r.reference
                left join reviews v on i.workspace=v.workspace and i.reference=v.reference where i.workspace=@w
                union all select r.reference, @unmapped, null, r.received, r.day, v.reason from receipts r
                left join invoices i on i.workspace=r.workspace and i.reference=r.reference
                left join reviews v on r.workspace=v.workspace and r.reference=v.reference
                where r.workspace=@w and i.reference is null order by Reference
                """,
                new { w, unmapped = "Sem título correspondente" },
                tx
            )
            .ToList();
    }

    public (int Count, bool Replay) Import(string w, string csv)
    {
        var (fingerprint, rows) = Batch.Parse(csv);
        using var db = Open();
        using var tx = db.BeginTransaction();
        // Unique keys arbitrate simultaneous uploads. A rejected batch rolls back all receipts.
        try
        {
            db.Execute("insert into batches values(@w,@fingerprint)", new { w, fingerprint }, tx);
        }
        catch (DbException e) when (UniqueViolation(e))
        {
            return (rows.Count, true);
        }
        try
        {
            foreach (var row in rows)
                db.Execute(
                    "insert into receipts values(@w,@Reference,@Received,@Day)",
                    new
                    {
                        w,
                        row.Reference,
                        row.Received,
                        row.Day,
                    },
                    tx
                );
        }
        catch (DbException e) when (UniqueViolation(e))
        {
            throw new DeskError(
                "Uma referência já foi importada. Nenhuma linha nova foi gravada.",
                409
            );
        }
        Append(db, tx, w, "import", fingerprint[..12], $"{rows.Count} repasses importados.");
        tx.Commit();
        return (rows.Count, false);
    }

    public void Review(string w, string reference, string? note)
    {
        var reason = note?.Trim() ?? "";
        if (reason.Length is < 8 or > 500)
            throw new DeskError("Registre uma justificativa de 8 a 500 caracteres.");
        using var db = Open();
        using var tx = db.BeginTransaction();
        var entry = Entries(w, db, tx).SingleOrDefault(x => x.Reference == reference)
            ?? throw new DeskError("Referência desconhecida.", 404);
        if (entry.Status is not ("disputed" or "orphan"))
            throw new DeskError("Apenas divergências abertas aceitam revisão.", 409);
        try
        {
            db.Execute(
                "insert into reviews values(@w,@reference,@reason)",
                new
                {
                    w,
                    reference,
                    reason,
                },
                tx
            );
        }
        catch (DbException e) when (UniqueViolation(e))
        {
            throw new DeskError("Já existe revisão para esta referência.", 409);
        }
        Append(db, tx, w, "review", reference, reason);
        tx.Commit();
    }

    private static void Append(
        DbConnection db,
        DbTransaction tx,
        string w,
        string kind,
        string reference,
        string detail
    )
    {
        db.Execute(
            "insert into events values(@id,@w,@kind,@reference,@detail,@stamp,0)",
            new
            {
                id = Guid.NewGuid().ToString("N"),
                w,
                kind,
                reference,
                detail,
                stamp = DateTimeOffset.UtcNow.ToString("O"),
            },
            tx
        );
    }

    public List<Event> Events(string w)
    {
        using var db = Open();
        return db.Query<Event>(
                "select id,workspace,kind,ref,detail,stamp from events where workspace=@w order by stamp desc",
                new { w }
            )
            .ToList();
    }
}
