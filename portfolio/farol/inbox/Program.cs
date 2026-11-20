using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using FarolInbox;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 4096);
builder.Services.ConfigureHttpJsonOptions(options => {
    options.SerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow;
    options.SerializerOptions.PropertyNameCaseInsensitive = false;
});
builder.Services.AddSingleton<InboxStore>();
var secret = builder.Configuration["INBOX_TOKEN"];
if (string.IsNullOrWhiteSpace(secret)) throw new InvalidOperationException("Configure INBOX_TOKEN.");
var secretHash = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
var app = builder.Build();
await app.Services.GetRequiredService<InboxStore>().MigrateAsync();
app.Use(async (ctx, next) => {
    ctx.Response.Headers.CacheControl = "no-store";
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    if (ctx.Request.Path.StartsWithSegments("/events", StringComparison.OrdinalIgnoreCase)) {
        // Check authorization before JSON binding, including malformed/oversized envelopes.
        var supplied = ctx.Request.Headers["X-Inbox-Token"].ToString();
        if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(supplied)), secretHash)) {
            ctx.Response.StatusCode = 401;
            return;
        }
        if (ctx.Request.ContentLength > 4096) { ctx.Response.StatusCode = 413; return; }
    }
    try { await next(); }
    catch (InboxError e) when (!ctx.Response.HasStarted) {
        ctx.Response.StatusCode = e.Status;
        await ctx.Response.WriteAsJsonAsync(new { detail = e.Message });
    }
    catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested) {
        // A caller can resend the same event ID after a lost acknowledgment.
        ctx.Response.StatusCode = 499;
    }
    catch (DbException e) when (!ctx.Response.HasStarted) {
        app.Logger.LogWarning("Inbox database unavailable ({Type}).", e.GetType().Name);
        ctx.Response.StatusCode = 503;
        ctx.Response.Headers.RetryAfter = "5";
        await ctx.Response.WriteAsJsonAsync(new { detail = "Caixa temporariamente indisponível. Reenvie o mesmo ID de evento." });
    }
});
app.MapGet("/health", async (InboxStore store, CancellationToken stop) => {
    await store.CheckHealthAsync(stop);
    return new { status = "ok" };
});
app.MapPost("/events", async (InboxEvent body, InboxStore store, CancellationToken stop) => {
    var id = await store.ReceiveAsync(body, stop);
    return Results.Ok(new { event_id = id });
});
app.Run();
