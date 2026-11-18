import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { HttpClient, provideHttpClient, HttpErrorResponse } from "@angular/common/http";
import { catchError, EMPTY, exhaustMap, firstValueFrom, Subscription, timer } from "rxjs";
import { mountYard } from "./yard.js";
import { Action, Dock, Snapshot, Session, statusNames, actionNames } from "./model";

@Component({ selector: "dn-app", standalone: true, templateUrl: "./yard.html" })
class YardPage implements AfterViewInit, OnDestroy {
  @ViewChild("scene", { static: true }) scene!: ElementRef<HTMLElement>;
  private readonly api = inject(HttpClient);
  readonly data = signal<Snapshot>({ docks: [], moves: [] });
  readonly session = signal<Session | null>(null);
  readonly selected = signal("D1");
  readonly dock = computed(() => this.data().docks.find((d) => d.id === this.selected()));
  readonly notice = signal("");
  readonly error = signal("");
  readonly busy = signal(false);
  readonly labels = statusNames;
  readonly actions = actionNames;
  readonly synced = signal("");
  readonly statuses = ["free", "booked", "servicing"] as const;
  carrier = "";
  private model?: ReturnType<typeof mountYard>;
  private refresh?: Subscription;
  private retry?: { signature: string; key: string };
  private changeNumber = 0;
  readonly clock = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  count(status: string) {
    return this.data().docks.filter((d) => d.status === status).length;
  }

  ngAfterViewInit() {
    this.model = mountYard(this.scene.nativeElement, {
      docks: [],
      selectedId: "D1",
      onSelect: (id) => this.select(id),
    });
    this.loadSession();
    this.refresh = timer(0, 10000)
      .pipe(
        exhaustMap(() => {
          const generation = this.changeNumber;
          return this.api.get<Snapshot>("/api/yard").pipe(
            catchError(() => {
              this.error.set("Sem conexão com o pátio. Tentaremos novamente.");
              return EMPTY;
            }),
            // A read that started before a mutation must not roll the view back.
            exhaustMap((value) => {
              if (generation === this.changeNumber) this.paint(value);
              return EMPTY;
            }),
          );
        }),
      )
      .subscribe();
  }
  async loadSession() {
    try {
      this.session.set(await firstValueFrom(this.api.get<Session>("/api/session")));
    } catch {
      this.error.set("Sessão indisponível. Atualize para tentar novamente.");
    }
  }
  select(id: string) {
    this.selected.set(id);
    this.carrier = "";
    this.notice.set("");
    this.model?.update(this.data().docks, id);
  }
  private paint(value: Snapshot) {
    this.data.set(value);
    this.model?.update(value.docks, this.selected());
    this.synced.set(this.clock.format(new Date()));
    if (this.error().startsWith("Sem conexão")) this.error.set("");
  }
  async move(dock: Dock, action: Action) {
    const session = this.session();
    if (!session?.canWrite || this.busy()) return;
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
    this.changeNumber++;
    const signature = JSON.stringify([dock.id, body]);
    if (this.retry?.signature !== signature) this.retry = { signature, key: crypto.randomUUID() };
    let applied = false;
    try {
      await firstValueFrom(
        this.api.post("/api/docks/" + dock.id + "/moves", body, {
          headers: { [session.csrfHeader]: session.csrf, "Idempotency-Key": this.retry.key },
        }),
      );
      applied = true;
      this.retry = undefined;
      this.carrier = "";
      this.notice.set(this.actions[action] + " · " + dock.id);
      this.paint(await firstValueFrom(this.api.get<Snapshot>("/api/yard")));
    } catch (reason) {
      const failure = reason as HttpErrorResponse;
      this.error.set(
        applied
          ? "Movimento registrado. Aguardando atualização do pátio."
          : failure.error?.detail || "Não foi possível confirmar. Você pode tentar novamente.",
      );
      if (failure.status === 409)
        this.paint(await firstValueFrom(this.api.get<Snapshot>("/api/yard")).catch(() => this.data()));
      if (failure.status === 403) await this.loadSession();
    } finally {
      this.changeNumber++;
      this.busy.set(false);
    }
  }
  ngOnDestroy() {
    this.refresh?.unsubscribe();
    this.model?.destroy();
  }
}
bootstrapApplication(YardPage, { providers: [provideHttpClient()] }).catch(console.error);
