using System.Security.Claims;
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
    }
);
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRouting();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();
app.MapGet("/api/health", () => new { status = "ok" });
app.MapGet("/api/session", (HttpContext ctx) =>
    new { logged = ctx.User.Identity?.IsAuthenticated ?? false, name = ctx.User.Identity?.Name }
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
