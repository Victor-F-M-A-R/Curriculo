# Lastro · Two-minute technical walkthrough

**Open the book.** “This is a reconciliation desk for a fictional payment operation. Each row compares a payment we expected with the amount we received. The first number is the sum of open discrepancies in absolute cents. It keeps positive and negative differences from cancelling each other out.”

**Import a settlement.** Open *Importar extrato*, choose the sample and confirm. “The API validates every row before committing the batch. It stores money in integer cents. Let me import the same file again. The API recognizes the batch, and the totals stay the same.”

**Explain a discrepancy.** Open REP-1048. “We expected BRL 1,967.50 and received BRL 1,950.00. I can explain the BRL 17.50 difference without rewriting the payment.” Record a note and open the Blazor audit trail.

**Show the code.** “The React UI calls ASP.NET Core. Dapper handles parameterized SQL. The same persistence tests ran on SQLite and PostgreSQL. Database transactions keep the ledger and its audit record consistent.”

**Discuss deployment.** “The repository contains an ECS deployment workflow using short-lived AWS credentials through OIDC. Running it requires a configured AWS environment. I would choose the database, shared key storage and health checks before opening access to real users.”

**Question to practice.** If a container crashes after writing an audit document to Cosmos but before marking the event as exported, what happens on retry? Trace the stable event ID and partition key in the projector.
