import {
  AfterViewInit, Component, computed, DestroyRef, ElementRef, inject,
  OnDestroy, signal, ViewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { bootstrapApplication } from "@angular/platform-browser";
import { HttpClient, provideHttpClient, HttpErrorResponse } from "@angular/common/http";
import { firstValueFrom, timer } from "rxjs";
import { mountYard } from "./yard.js";
import { Action, Dock, Snapshot, Session, statusNames, actionNames, validSnapshot, validSession } from "./model";

const pollInterval = 10_000;
const readLifetime = 20_000;

@Component({ selector: "dn-app", standalone: true, templateUrl: "./yard.html" })
class YardPage implements AfterViewInit, OnDestroy {
  @ViewChild("scene", { static: true }) scene!: ElementRef<HTMLElement>;
  private readonly api = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly data = signal<Snapshot>({ docks: [], moves: [] });
  readonly session = signal<Session | null>(null);
  readonly sessionProblem = signal(false);
  readonly selected = signal("D1");
  readonly dock = computed(() => this.data().docks.find((d) => d.id === this.selected()));
  readonly notice = signal("");
  readonly error = signal("");
  readonly busy = signal(false);
  readonly reading = signal(false);
  readonly loadingSession = signal(false);
  readonly labels = statusNames;
  readonly actions = actionNames;
  readonly lastRead = signal<Date | null>(null);
  private readonly readFailed = signal(false);
  private readonly now = signal(Date.now());
  readonly freshness = computed<"waiting" | "unavailable" | "fresh" | "stale">(() => {
    const last = this.lastRead();
    if (!last) return this.readFailed() ? "unavailable" : "waiting";
    return this.readFailed() || this.now() - last.getTime() > readLifetime ? "stale" : "fresh";
  });
  readonly qualityLabels = {
    waiting: "Aguardando leitura", unavailable: "Sem leitura", fresh: "Atualizada", stale: "Desatualizada",
  };
  readonly statuses = ["free", "booked", "servicing"] as const;
  readonly clock = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  carrier = "";
  private model?: ReturnType<typeof mountYard>;
  private retry?: { signature: string; key: string };
  private readNumber = 0;
  private sessionNumber = 0;
  private authorizationEpoch = 0;
  private authorizationDenied = false;

  count(status: string) {
    return this.data().docks.filter((d) => d.status === status).length;
  }

  ngAfterViewInit() {
    this.model = mountYard(this.scene.nativeElement, {
      docks: [],
      selectedId: "D1",
      onSelect: (id) => this.select(id),
    });
    timer(0, 1000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.now.set(Date.now()));
    timer(0, pollInterval).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
  }

  async refresh() {
    if (this.busy() || this.reading() || this.loadingSession()) return;
    await this.loadSession();
    if (!this.destroyRef.destroyed && !this.busy() && !this.authorizationDenied) await this.readBoard();
  }

  private clearAuthorization() {
    // Invalidate both kinds of request: an earlier successful response must not
    // restore data or permissions after a later denial has been observed.
    this.authorizationEpoch++;
    this.sessionNumber++;
    this.readNumber++;
    this.loadingSession.set(false);
    this.reading.set(false);
    this.authorizationDenied = true;
    this.data.set({ docks: [], moves: [] });
    this.model?.update([], this.selected());
    this.lastRead.set(null);
    this.readFailed.set(true);
    this.carrier = "";
    this.notice.set("");
  }

  private async loadSession() {
    if (this.loadingSession()) return;
    const request = ++this.sessionNumber;
    const epoch = this.authorizationEpoch;
    this.loadingSession.set(true);
    try {
      const value = await firstValueFrom(this.api.get<Session>("/api/session", { timeout: 8000 })
        .pipe(takeUntilDestroyed(this.destroyRef)));
      if (!validSession(value)) throw new Error("Sessão inválida");
      if (this.destroyRef.destroyed || request !== this.sessionNumber || epoch !== this.authorizationEpoch) return;
      const previous = this.session();
      if (value.federated && !value.authenticated) {
        this.clearAuthorization();
      } else {
        if (previous?.federated && previous.actor !== value.actor) this.clearAuthorization();
        this.authorizationDenied = false;
      }
      this.session.set(value);
      this.sessionProblem.set(false);
    } catch (reason) {
      if (!this.destroyRef.destroyed && request === this.sessionNumber && epoch === this.authorizationEpoch) {
        if (reason instanceof HttpErrorResponse && [401, 403].includes(reason.status)) this.clearAuthorization();
        this.session.set(null);
        this.sessionProblem.set(true);
      }
    } finally {
      if (request === this.sessionNumber) this.loadingSession.set(false);
    }
  }

  select(id: string) {
    if (id === this.selected()) return;
    this.selected.set(id);
    this.carrier = "";
    this.notice.set("");
    this.error.set("");
    this.model?.update(this.data().docks, id);
  }

  private async readBoard() {
    if (this.authorizationDenied) return;
    const request = ++this.readNumber;
    const epoch = this.authorizationEpoch;
    this.reading.set(true);
    try {
      const value = await firstValueFrom(this.api.get<Snapshot>("/api/yard", { timeout: 8000 })
        .pipe(takeUntilDestroyed(this.destroyRef)));
      if (request !== this.readNumber || epoch !== this.authorizationEpoch || this.authorizationDenied || this.destroyRef.destroyed) return;
      if (!validSnapshot(value)) throw new Error("Leitura inválida ou antiga");
      this.data.set(value);
      this.model?.update(value.docks, this.selected());
      const received = new Date();
      this.lastRead.set(new Date(value.sampledAt!));
      this.now.set(received.getTime());
      this.readFailed.set(false);
    } catch (reason) {
      if (request === this.readNumber && !this.destroyRef.destroyed) {
        this.readFailed.set(true);
        if (reason instanceof HttpErrorResponse && [401, 403].includes(reason.status)) {
          this.clearAuthorization();
          this.session.set(null);
          void this.loadSession();
        }
      }
    } finally {
      if (request === this.readNumber && !this.destroyRef.destroyed) this.reading.set(false);
    }
  }

  async move(dock: Dock, action: Action) {
    const session = this.session();
    this.now.set(Date.now());
    if (!session?.canWrite || this.busy() || this.freshness() !== "fresh") return;
    const body = {
      action,
      carrier: action === "book" ? this.carrier.trim() : "",
      expectedVersion: dock.version,
    };
    if (action === "book" && !body.carrier) {
      this.error.set("Informe a transportadora.");
      return;
    }
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    // An earlier poll must never overwrite a decision or its follow-up read.
    this.readNumber++;
    this.reading.set(false);
    const signature = JSON.stringify([dock.id, body]);
    if (this.retry?.signature !== signature) this.retry = { signature, key: crypto.randomUUID() };
    try {
      await firstValueFrom(this.api.post("/api/docks/" + dock.id + "/moves", body, {
        headers: { [session.csrfHeader]: session.csrf, "Idempotency-Key": this.retry.key },
        timeout: 10000,
      }).pipe(takeUntilDestroyed(this.destroyRef)));
      this.retry = undefined;
      if (this.selected() === dock.id) this.carrier = "";
      this.notice.set(this.actions[action] + " · " + dock.id);
    } catch (reason) {
      if (this.destroyRef.destroyed) return;
      const failure = reason as HttpErrorResponse;
      this.error.set(failure.error?.detail || "Não foi possível confirmar o movimento. Confira a última leitura antes de tentar novamente.");
      if ([401, 403].includes(failure.status)) {
        this.clearAuthorization();
        this.session.set(null);
        await this.loadSession();
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        await this.readBoard();
        this.busy.set(false);
      }
    }
  }

  ngOnDestroy() {
    this.model?.destroy();
  }
}
bootstrapApplication(YardPage, { providers: [provideHttpClient()] }).catch(console.error);
