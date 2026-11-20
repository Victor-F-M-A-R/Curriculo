using System.Security.Claims;
using System.Data.Common;
using System.Threading.RateLimiting;
using Lastro;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 160_000);
builder.Services.AddSingleton<Book>();
builder.Services.AddHostedService<CosmosProjection>();
builder.Services.AddRazorComponents();
builder
    .Services.AddAuthentication("desk")
    .AddCookie("desk", opts =>
    {
        opts.Cookie.Name = "lastro.desk";
        opts.Cookie.HttpOnly = true;
        opts.Cookie.SameSite = SameSiteMode.Strict;
        opts.ExpireTimeSpan = TimeSpan.FromHours(8);
        opts.Events.OnRedirectToLogin = ctx =>
        {
            ctx.Response.StatusCode = 401;
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("access", ctx =>
        RateLimitPartition.GetFixedWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "local",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }
        )
    );
});
var app = builder.Build();
app.Services.GetRequiredService<Book>().Migrate();
app.Use(
    async (ctx, next) =>
    {
        ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
        ctx.Response.Headers["Content-Security-Policy"] = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
        ctx.Response.Headers["Referrer-Policy"] = "same-origin";
        if (
            ctx.Request.Path.StartsWithSegments("/api")
            || ctx.Request.Path.StartsWithSegments("/audit")
        )
            ctx.Response.Headers.CacheControl = "no-store";
        if (
            HttpMethods.IsPost(ctx.Request.Method)
            && ctx.Request.Headers["X-Lastro-Client"] != "desk"
        )
        {
            ctx.Response.StatusCode = 403;
            return;
        }
        try
        {
            await next();
        }
        catch (DeskError e)
        {
            ctx.Response.StatusCode = e.Status;
            await ctx.Response.WriteAsJsonAsync(new { detail = e.Message });
        }
        catch (DbException e) when (!ctx.Response.HasStarted)
        {
            app.Logger.LogWarning("Book database unavailable ({Type}).", e.GetType().Name);
            ctx.Response.StatusCode = 503;
            ctx.Response.Headers.RetryAfter = "5";
            await ctx.Response.WriteAsJsonAsync(new {
                detail = "O banco está temporariamente indisponível. Atualize a página para conferir os dados antes de repetir a operação."
            });
        }
    }
);
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRouting();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();
app.MapGet("/api/health", (Book book) => { book.CheckHealth(); return new { status = "ok" }; });
app.MapGet("/api/session", (HttpContext ctx) =>
    new { logged = ctx.User.Identity?.IsAuthenticated ?? false, name = ctx.User.Identity?.Name,
        workspace = ctx.User.FindFirstValue("workspace") }
);
app.MapPost("/api/session/demo", async (HttpContext ctx, Book book) =>
    {
        if (ctx.User.Identity?.IsAuthenticated != true)
            await Sign(ctx, book.Create(), "Mesa demo");
        return Results.NoContent();
    })
    .RequireRateLimiting("access");
app.MapPost("/api/register", async (Login login, HttpContext ctx, Book book) =>
    {
        var user = Handle(login.User);
        if (login.Password is not { Length: >= 12 and <= 128 })
            throw new DeskError("Use uma senha de 12 a 128 caracteres.");
        var hash = new PasswordHasher<string>().HashPassword(user, login.Password);
        await Sign(ctx, book.Create(user, hash), user);
        return Results.NoContent();
    })
    .RequireRateLimiting("access");
app.MapPost("/api/login", async (Login login, HttpContext ctx, Book book) =>
    {
        var user = Handle(login.User);
        var account = book.Account(user);
        if (
            login.Password is not { Length: > 0 and <= 128 }
            || account is null
            || new PasswordHasher<string>().VerifyHashedPassword(
                user,
                account.Value.Hash,
                login.Password
            ) == PasswordVerificationResult.Failed
        )
            throw new DeskError("Credenciais inválidas.", 401);
        await Sign(ctx, account.Value.Workspace, user);
        return Results.NoContent();
    })
    .RequireRateLimiting("access");
app.MapPost("/api/logout", async (HttpContext ctx) =>
{
    await ctx.SignOutAsync("desk");
    return Results.NoContent();
});
var api = app.MapGroup("/api/book").RequireAuthorization();
api.AddEndpointFilter(async (context, next) =>
{
    var http = context.HttpContext;
    var expected = http.Request.Headers["X-Lastro-Workspace"];
    // Cookies are shared across tabs. A stale page must never write into a newly selected account.
    if (HttpMethods.IsPost(http.Request.Method) && string.IsNullOrWhiteSpace(expected.ToString()))
        return Results.Json(new { code = "workspace_required",
            detail = "Atualize a sessão da mesa e envie X-Lastro-Workspace antes de alterar o livro." }, statusCode: 428);
    if (expected.Count > 0 && (expected.Count != 1 || expected[0] != Workspace(http.User)))
        return Results.Json(new { code = "workspace_changed",
            detail = "A conta mudou em outra aba. Carregue a mesa atual antes de realizar uma nova operação." }, statusCode: 409);
    return await next(context);
});
api.MapGet("", (ClaimsPrincipal user, Book book) => book.Entries(Workspace(user)));
api.MapGet("/events", (ClaimsPrincipal user, Book book) => book.Events(Workspace(user)));
api.MapPost("/import", (ImportRequest batch, ClaimsPrincipal user, Book book) =>
{
    var (count, replay) = book.Import(Workspace(user), batch.Csv);
    return new { count, replay };
});
api.MapPost(
    "/{reference}/review",
    (string reference, ReviewRequest review, ClaimsPrincipal user, Book book) =>
    {
        book.Review(Workspace(user), reference, review.Note);
        return Results.NoContent();
    }
);
app.MapRazorComponents<Lastro.Components.App>();
app.Run();

static string Handle(string? input)
{
    string value = input?.Trim().ToLowerInvariant() ?? "";
    if (!System.Text.RegularExpressions.Regex.IsMatch(value, @"^[a-z0-9._-]{3,32}$"))
        throw new DeskError("Use um usuário de 3 a 32 letras, números, pontos ou traços.");
    return value;
}
static string Workspace(ClaimsPrincipal user) => user.FindFirstValue("workspace")!;
static async Task Sign(HttpContext ctx, string w, string name)
{
    var principal = new ClaimsPrincipal(
        new ClaimsIdentity([new Claim("workspace", w), new Claim(ClaimTypes.Name, name)], "desk")
    );
    await ctx.SignInAsync("desk", principal);
}
