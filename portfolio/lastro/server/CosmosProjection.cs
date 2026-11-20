using Dapper;
using Microsoft.Azure.Cosmos;

namespace Lastro;

// Transactional outbox. A process crash after the upsert can replay the same document safely.
public sealed class CosmosProjection(
    Book book,
    IConfiguration config,
    ILogger<CosmosProjection> logger
) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var connection = config["COSMOS_CONNECTION"];
        if (string.IsNullOrWhiteSpace(connection))
            return;
        using var client = new CosmosClient(connection);
        var container = client.GetContainer(
            config["COSMOS_DATABASE"] ?? "lastro",
            config["COSMOS_CONTAINER"] ?? "audit"
        );
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var db = book.Open();
                var query =
                    string.Equals(config["BOOK_ENGINE"], "sqlserver", StringComparison.OrdinalIgnoreCase)
                        ? "select top (50) id,workspace,kind,ref,detail,stamp from events where exported=0 order by stamp"
                        : "select id,workspace,kind,ref,detail,stamp from events where exported=0 order by stamp limit 50";
                foreach (var item in await db.QueryAsync<Event>(new CommandDefinition(query,
                    commandTimeout: Book.DatabaseTimeoutSeconds, cancellationToken: stop)))
                {
                    var doc = new
                    {
                        id = item.Id,
                        workspace = item.Workspace,
                        kind = item.Kind,
                        reference = item.Ref,
                        detail = item.Detail,
                        stamp = item.Stamp,
                    };
                    await container.UpsertItemAsync(
                        doc,
                        new PartitionKey(item.Workspace),
                        cancellationToken: stop
                    );
                    await db.ExecuteAsync(new CommandDefinition(
                        "update events set exported=1 where id=@Id",
                        new { item.Id }, commandTimeout: Book.DatabaseTimeoutSeconds, cancellationToken: stop
                    ));
                }
            }
            catch (Exception e) when (!stop.IsCancellationRequested)
            {
                logger.LogWarning("Projection delayed ({Type}).", e.GetType().Name);
            }
            await Task.Delay(TimeSpan.FromSeconds(10), stop);
        }
    }
}
