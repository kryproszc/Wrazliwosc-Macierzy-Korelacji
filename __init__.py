################
import matplotlib.pyplot as plt

for model in ["Incurred", "Rezerwy"]:

    dane = wyniki_zakresy[
        wyniki_zakresy["Model"] == model
    ]

    fig, ax = plt.subplots(figsize=(11, 5))

    for rozklad in ["normal", "gamma", "lognormal"]:

        d = dane[
            dane["Rozkład"] == rozklad
        ].sort_values("Max okres")

        ax.plot(
            d["Max okres"],
            d["p-value KS"],
            marker="o",
            label=rozklad
        )

    ax.axhline(
        y=0.05,
        color="red",
        linestyle="--",
        linewidth=1.5,
        label="Poziom istotności 0.05"
    )

    ax.set_title(f"{model} — p-value KS według zakresu rozwoju")
    ax.set_xlabel("Maksymalny okres rozwoju")
    ax.set_ylabel("p-value KS")
    ax.set_xticks(range(3, 22))
    ax.set_ylim(0, 1)
    ax.grid(alpha=0.3)
    ax.legend()

    plt.show()




##################

import numpy as np
import matplotlib.pyplot as plt
from scipy import stats


def plot_diagnostics_side_by_side(
    reszty_wszystkie,
    model="Rezerwy",
    max_okres=5
):
    """
    Rysuje diagnostykę dopasowania w układzie 1x3
    dla rozkładów: normal, gamma, lognormal.

    Zakłada, że w reszty_wszystkie są kolumny:
    ['Model', 'Okres', 'normal', 'gamma', 'lognormal'].
    """

    # wybór danych
    dane = reszty_wszystkie[
        (reszty_wszystkie["Model"] == model) &
        (reszty_wszystkie["Okres"] <= max_okres)
    ].copy()

    rozklady = ["normal", "gamma", "lognormal"]

    # przygotowanie wspólnego zakresu osi X
    wszystkie_z = []
    for rozklad in rozklady:
        z = dane[rozklad].dropna().to_numpy(dtype=float)
        wszystkie_z.append(z)

    z_all = np.concatenate(wszystkie_z)
    x_min = min(-4, np.min(z_all) - 0.2)
    x_max = max(4, np.max(z_all) + 0.2)
    x_grid = np.linspace(x_min, x_max, 500)

    # =========================
    # 1. QQ-PLOTY
    # =========================
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))

    for ax, rozklad in zip(axes, rozklady):
        z = dane[rozklad].dropna().to_numpy(dtype=float)
        stats.probplot(z, dist="norm", plot=ax)
        ax.set_title(f"QQ-plot — {rozklad}")
        ax.grid(alpha=0.3)

    fig.suptitle(
        f"{model} — QQ-ploty (okresy 1–{max_okres})",
        fontsize=14
    )
    plt.tight_layout()
    plt.show()

    # =========================
    # 2. PP-PLOTY
    # =========================
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))

    for ax, rozklad in zip(axes, rozklady):
        z = dane[rozklad].dropna().to_numpy(dtype=float)
        u = np.sort(stats.norm.cdf(z))
        p = (np.arange(1, len(u) + 1) - 0.5) / len(u)

        ax.plot(u, p, "o", markersize=4)
        ax.plot([0, 1], [0, 1], "k--")
        ax.set_title(f"PP-plot — {rozklad}")
        ax.set_xlabel("Teoretyczne prawdopodobieństwo")
        ax.set_ylabel("Empiryczne prawdopodobieństwo")
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.grid(alpha=0.3)

    fig.suptitle(
        f"{model} — PP-ploty (okresy 1–{max_okres})",
        fontsize=14
    )
    plt.tight_layout()
    plt.show()

    # =========================
    # 3. DYSTRYBUANTY
    # =========================
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))

    for ax, rozklad in zip(axes, rozklady):
        z = np.sort(dane[rozklad].dropna().to_numpy(dtype=float))
        ecdf = np.searchsorted(z, x_grid, side="right") / len(z)
        cdf_theoretical = stats.norm.cdf(x_grid)

        ax.plot(x_grid, ecdf, label="Empiryczna")
        ax.plot(x_grid, cdf_theoretical, "--", label="Teoretyczna N(0,1)")
        ax.set_title(f"Dystrybuanta — {rozklad}")
        ax.set_xlabel("z")
        ax.set_ylabel("F(z)")
        ax.grid(alpha=0.3)
        ax.legend()

    fig.suptitle(
        f"{model} — porównanie dystrybuant (okresy 1–{max_okres})",
        fontsize=14
    )
    plt.tight_layout()
    plt.show()

    # =========================
    # 4. GĘSTOŚCI
    # =========================
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))

    for ax, rozklad in zip(axes, rozklady):
        z = dane[rozklad].dropna().to_numpy(dtype=float)

        ax.hist(z, bins="auto", density=True, alpha=0.5)
        ax.plot(x_grid, stats.norm.pdf(x_grid))
        ax.set_title(f"Gęstość — {rozklad}")
        ax.set_xlabel("z")
        ax.set_ylabel("gęstość")
        ax.grid(alpha=0.3)

    fig.suptitle(
        f"{model} — porównanie gęstości (okresy 1–{max_okres})",
        fontsize=14
    )
    plt.tight_layout()
    plt.show()


plot_diagnostics_side_by_side(
    reszty_wszystkie=reszty_wszystkie,
    model="Rezerwy",
    max_okres=5
)


plot_diagnostics_side_by_side(
    reszty_wszystkie=reszty_wszystkie,
    model="Incurred",
    max_okres=5
)



import numpy as np
import pandas as pd

from scipy import stats, optimize, special


def porownaj_6_rozkladow_PI(
    I, R, E_I, E_R,
    h, g, theta2_I, theta2_R,
    weights_inc,
    weights_R=None,
    max_okres=5,
    n_mc=5000,
    seed=12345
):

    if weights_R is None:
        weights_R = weights_inc

    a = I.shape[0]

    rozklady = [
        "normal",
        "gamma",
        "lognormal",
        "Student-t",
        "Weibull",
        "Log-logistyczny"
    ]

    rng = np.random.default_rng(seed)

    # ==========================================
    # 1. STATYSTYKA AD
    # ==========================================

    def ad_stat(z):
        z = np.sort(np.asarray(z, dtype=float), axis=-1)
        n = z.shape[-1]
        k = np.arange(1, n + 1)

        return (
            -n
            - np.sum(
                (2*k - 1) * (
                    stats.norm.logcdf(z)
                    + stats.norm.logsf(np.flip(z, axis=-1))
                ),
                axis=-1
            ) / n
        )

    # Rozkład zerowy statystyki AD
    mc_cache = {}

    def pvalue_ad(ad, n):
        if n not in mc_cache:
            sim = rng.standard_normal((n_mc, n))
            mc_cache[n] = ad_stat(sim)

        return (
            (np.sum(mc_cache[n] >= ad) + 1)
            / (n_mc + 1)
        )

    # ==========================================
    # 2. ROZKŁADY STANDARYZOWANE
    # ==========================================

    def rozklad_z(nazwa, k):

        if nazwa == "Student-t":
            return stats.t(
                df=k,
                loc=0,
                scale=np.sqrt((k - 2) / k)
            )

        if nazwa == "Weibull":
            m = special.gamma(1 + 1/k)
            v = special.gamma(1 + 2/k) - m**2
            s = np.sqrt(v)

            return stats.weibull_min(
                c=k,
                loc=-m/s,
                scale=1/s
            )

        if nazwa == "Log-logistyczny":
            m = (np.pi/k) / np.sin(np.pi/k)
            m2 = (2*np.pi/k) / np.sin(2*np.pi/k)
            s = np.sqrt(m2 - m**2)

            return stats.fisk(
                c=k,
                loc=-m/s,
                scale=1/s
            )

    # ==========================================
    # 3. ESTYMACJA KSZTAŁTU
    # ==========================================

    def estymuj_ksztalt(z, nazwa):

        granice = {
            "Student-t": (2.01, 200),
            "Weibull": (0.2, 100),
            "Log-logistyczny": (2.01, 100)
        }

        def cel(k):
            dist = rozklad_z(nazwa, k)
            lp = dist.logpdf(z)

            if not np.all(np.isfinite(lp)):
                return np.inf

            return -np.sum(lp)

        lo, hi = granice[nazwa]

        # Poszukiwanie minimum na siatce,
        # następnie lokalne doprecyzowanie
        grid = np.geomspace(lo, hi, 100)
        vals = np.array([cel(k) for k in grid])

        idx = np.argmin(vals)

        left = grid[max(idx - 1, 0)]
        right = grid[min(idx + 1, len(grid) - 1)]

        wynik = optimize.minimize_scalar(
            cel,
            bounds=(left, right),
            method="bounded"
        )

        if wynik.success and wynik.fun < vals[idx]:
            return float(wynik.x)

        return float(grid[idx])

    # ==========================================
    # 4. CRPS Z FUNKCJI KWANTYLOWEJ
    # ==========================================

    # Kwadratura Gaussa-Legendre'a
    x_nodes, w_nodes = special.roots_legendre(128)

    u_nodes = (x_nodes + 1) / 2
    w_nodes = w_nodes / 2

    def crps_sredni(y, dist):

        q = dist.ppf(u_nodes)

        # q ma wymiary (obserwacje, węzły)
        if q.ndim == 1:
            q = np.broadcast_to(q, (len(y), len(q)))

        error = y[:, None] - q

        pinball = error * (
            u_nodes[None, :] - (error < 0)
        )

        crps = 2 * np.sum(
            pinball * w_nodes[None, :],
            axis=1
        )

        return float(np.mean(crps))

    # ==========================================
    # 5. WYBÓR OBSERWACJI
    # ==========================================

    wyniki = []
    parametry = []
    diagnostyka = []

    konfiguracje = [
        ("Incurred", I, E_I, h, theta2_I, weights_inc),
        ("Rezerwy", R, E_R, g, theta2_R, weights_R)
    ]

    for model, X, E, coef, theta2, W in konfiguracje:

        obserwacje = []
        wybrane = 0

        for j in range(max_okres):

            n_rows = a - j - 1

            selected = np.flatnonzero(
                W[:n_rows, j] == 1
            )

            wybrane += len(selected)

            for i in selected:

                e = E[i, j]
                y = X[i, j + 1]

                if model == "Incurred":
                    mu = X[i, j] + coef[j] * e
                else:
                    mu = coef[j] * e

                var = theta2[j] * e

                # Wspólna próba dla wszystkich
                # sześciu rozkładów
                if not (
                    np.isfinite(y)
                    and np.isfinite(e)
                    and np.isfinite(mu)
                    and np.isfinite(var)
                    and e > 0
                    and mu > 0
                    and var > 0
                    and y > 0
                ):
                    continue

                obserwacje.append((y, mu, var))

        dane = np.asarray(obserwacje, dtype=float)

        if len(dane) == 0:
            raise ValueError(f"Brak obserwacji: {model}")

        y = dane[:, 0]
        mu = dane[:, 1]
        var = dane[:, 2]
        sd = np.sqrt(var)

        z = (y - mu) / sd

        print(
            f"{model}: wybrane wagami = {wybrane}, "
            f"do testów = {len(z)}"
        )

        diagnostyka.append({
            "Model": model,
            "Wybrane wagami": wybrane,
            "Do testów": len(z),
            "Wyłączone": wybrane - len(z)
        })

        # ======================================
        # 6. DOPASOWANIE SZEŚCIU ROZKŁADÓW
        # ======================================

        for nazwa in rozklady:

            print(f"  {nazwa}")

            k = np.nan

            if nazwa == "normal":

                dist = stats.norm(
                    loc=mu[:, None],
                    scale=sd[:, None]
                )

            elif nazwa == "gamma":

                shape = mu**2 / var
                scale = var / mu

                dist = stats.gamma(
                    a=shape[:, None],
                    scale=scale[:, None]
                )

            elif nazwa == "lognormal":

                s2 = np.log1p(var / mu**2)

                sigma_log = np.sqrt(s2)
                mu_log = np.log(mu) - s2/2

                dist = stats.lognorm(
                    s=sigma_log[:, None],
                    scale=np.exp(mu_log)[:, None]
                )

            else:

                k = estymuj_ksztalt(z, nazwa)

                # Rozkład standaryzowanego błędu
                dz = rozklad_z(nazwa, k)

                # Kwantyle warunkowe:
                # Q_Y(u) = mu + sd * Q_Z(u)
                class Warunkowy:
                    def ppf(self, u):
                        return (
                            mu[:, None]
                            + sd[:, None] * dz.ppf(u)
                        )

                dist = Warunkowy()

            # ==================================
            # 7. PIT
            # ==================================

            if nazwa == "normal":
                u = stats.norm.cdf(y, loc=mu, scale=sd)

            elif nazwa == "gamma":
                u = stats.gamma.cdf(
                    y, a=shape, scale=scale
                )

            elif nazwa == "lognormal":
                u = stats.lognorm.cdf(
                    y,
                    s=sigma_log,
                    scale=np.exp(mu_log)
                )

            else:
                u = dz.cdf(z)

            eps = np.finfo(float).eps

            u = np.clip(u, eps, 1 - eps)
            z_pit = stats.norm.ppf(u)

            # ==================================
            # 8. KS I AD
            # ==================================

            ks = stats.kstest(z_pit, "norm")

            ad = float(ad_stat(z_pit))

            p_ad = pvalue_ad(ad, len(z_pit))

            # ==================================
            # 9. CRPS
            # ==================================

            crps = crps_sredni(y, dist)

            wyniki.append({
                "Model": model,
                "Rozkład": nazwa,
                "Liczebność próby": len(z),
                "Średnia": np.mean(z_pit),
                "Odchylenie standardowe": np.std(
                    z_pit, ddof=1
                ),
                "Statystyka testowa KS": ks.statistic,
                "p-value KS": ks.pvalue,
                "Statystyka testowa AD": ad,
                "p-value AD": p_ad,
                "Średni CRPS": crps
            })

            parametry.append({
                "Model": model,
                "Rozkład": nazwa,
                "Parametr kształtu": k
            })

    tabela = pd.DataFrame(wyniki)
    tabela_parametrow = pd.DataFrame(parametry)
    diagnostyka = pd.DataFrame(diagnostyka)

    return tabela, tabela_parametrow, diagnostyka



tabela_6, parametry_6, diagnostyka_6 = porownaj_6_rozkladow_PI(
    I=I,
    R=R,
    E_I=E_I,
    E_R=E_R,
    h=h,
    g=g,
    theta2_I=theta2_I,
    theta2_R=theta2_R,
    weights_inc=weights_inc,
    max_okres=5,
    n_mc=5000,
    seed=12345
)

print("INCURRED")
pd.set_option("display.float_format", "{:,.6f}".format)

display(
    tabela_6[tabela_6["Model"] == "Incurred"]
    .drop(columns="Model")
    .set_index("Rozkład")
    .T
)

display(
    tabela_6[tabela_6["Model"] == "Rezerwy"]
    .drop(columns="Model")
    .set_index("Rozkład")
    .T
)

print("PARAMETRY KSZTAŁTU")
display(parametry_6.round(6))

print("DIAGNOSTYKA LICZEBNOŚCI")
display(diagnostyka_6)


