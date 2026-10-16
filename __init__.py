import numpy as np

# Kopie macierzy historycznych
I_hat = I.copy()
R_hat = R.copy()
C_hat = C.copy()

# Macierz przyszłych płatności przyrostowych
X_paid_hat = np.full_like(C, np.nan)

a = I.shape[0]

# Prognozowanie dolnego trójkąta
for i in range(1, a):

    # Ostatnia obserwowana kolumna
    last = a - i - 1

    for j in range(last + 1, a):

        # Przyrost Incurred
        x_i = I_hat[i, j-1] * h[j-1]

        # Nowa rezerwa
        r_new = R_hat[i, j-1] * g[j-1]

        # Oczekiwane Incurred
        I_hat[i, j] = I_hat[i, j-1] + x_i

        # Oczekiwana rezerwa
        R_hat[i, j] = r_new

        # Przyszła płatność przyrostowa
        X_paid_hat[i, j] = (
            x_i - (r_new - R_hat[i, j-1])
        )

        # Skumulowane Paid
        C_hat[i, j] = C_hat[i, j-1] + X_paid_hat[i, j]

print("Wymiar X_paid_hat:", X_paid_hat.shape)

print(
    "Suma przyszłych płatności bez inflacji:",
    np.nansum(X_paid_hat)
)

def calculate_inflation_paid_incurred(
    X_paid_hat,
    inflacja,
    valuation_year=2024
):
    """
    Punkt 9 dokumentacji Paid-Incurred.

    Indeksacja przyszłych oczekiwanych płatności inflacją.

    Zwraca
    -------
    X_indexed : ndarray (a, a)
        Przyszłe płatności indeksowane inflacją.
        Część historyczna = NaN.

    inflation_factors : ndarray (a, a)
        Współczynniki inflacyjne dla przyszłych komórek.
    """

    X = np.asarray(X_paid_hat, dtype=np.float64)
    inflacja = np.asarray(inflacja, dtype=np.float64)

    a = X.shape[0]

    if X.shape != (a, a):
        raise ValueError("Trójkąt musi mieć wymiar (a, a).")

    if inflacja.ndim != 2 or inflacja.shape[1] != 2:
        raise ValueError("Inflacja musi mieć dwie kolumny: rok i stopa.")

    years = inflacja[:, 0].astype(int)
    rates = inflacja[:, 1]

    if len(np.unique(years)) != len(years):
        raise ValueError("Powtarzające się lata inflacji.")

    if np.any(~np.isfinite(rates)) or np.any(rates <= -1):
        raise ValueError("Niepoprawne stopy inflacji.")

    inflation_by_year = dict(zip(years, rates))

    X_indexed = np.full_like(X, np.nan)
    inflation_factors = np.full_like(X, np.nan)

    # Współczynnik pełnych poprzednich lat inflacji
    accumulated_factor = 1.0

    for k in range(1, a):

        calendar_year = valuation_year + k

        if calendar_year not in inflation_by_year:
            raise ValueError(
                f"Brak inflacji dla roku {calendar_year}."
            )

        rate = inflation_by_year[calendar_year]

        # Pełne lata poprzednie + pół bieżącego roku
        factor = accumulated_factor * np.sqrt(1.0 + rate)

        # Komórki przypadające na ten rok kalendarzowy
        # Rok szkodowy: valuation_year - (a-1) + i
        for i in range(1, a):
            j = a - 1 - i + k

            if 0 <= j < a:
                if not np.isfinite(X[i, j]):
                    raise ValueError(
                        f"Brak prognozy płatności: "
                        f"wiersz={i}, kolumna={j}."
                    )

                X_indexed[i, j] = X[i, j] * factor
                inflation_factors[i, j] = factor

        # Uwzględnienie pełnego roku w następnych okresach
        accumulated_factor *= 1.0 + rate

    return X_indexed, inflation_factors



h, theta2_I = calculate_parameters_inc(
    L_I=L_I,
    E_I=E_I,
    weights_inc=weights_inc
)

print("Współczynniki h:")
print(h)

print("\nParametry wariancji Incurred:")
print(theta2_I)

print("\nOdchylenia standardowe:")
print(np.sqrt(theta2_I))



g, theta2_R = calculate_parameters_R(
    L_R=L_R,
    E_R=E_R,
    weights_R=weights_inc,
    j_star=15
)

print("Współczynniki g:")
print(g)

print("\nParametry wariancji rezerw:")
print(theta2_R)

print("\nOdchylenia standardowe:")
print(np.sqrt(theta2_R))



lambda_S, r_I, r_R, diagnostics = calculate_lambda(
    X_I=X_I,
    X_R=X_R,
    E_I=E_I,
    E_R=E_R,
    h=h,
    g=g,
    theta2_I=theta2_I,
    theta2_R=theta2_R,
    weights_lambda=weights_inc,
    j_star=15
)

print("Korelacje Spearmana:")
for j, value in enumerate(lambda_S, start=1):
    print(f"j={j:2d} | lambda = {value:.8f}")

print("\nDiagnostyka:")
for j, n, status in diagnostics:
    print(f"j={j:2d} | n={n:2d} | {status}")




import numpy as np
from scipy.stats import spearmanr

W = np.asarray(weights_inc, dtype=float)

print("j  | Nasza lambda | scipy Spearman | Różnica")
print("-" * 58)

for j in range(14):

    n = E_I.shape[0] - j - 1

    selected = (
        (W[:n, j] == 1)
        & np.isfinite(r_I[:n, j])
        & np.isfinite(r_R[:n, j])
    )

    ri = r_I[:n, j][selected]
    rr = r_R[:n, j][selected]

    if len(ri) < 2:
        continue

    scipy_lambda = spearmanr(ri, rr).statistic

    nasza_lambda = lambda_S[j]

    roznica = nasza_lambda - scipy_lambda

    print(
        f"{j+1:2d} | "
        f"{nasza_lambda:12.8f} | "
        f"{scipy_lambda:14.8f} | "
        f"{roznica: .12f}"
    )



X_indexed, inflation_factors = calculate_inflation_paid_incurred(
    X_paid_hat=X_paid_hat,
    inflacja=inflacja,
    valuation_year=2024
)

import pandas as pd

X_indexed_df = pd.DataFrame(
    X_indexed,
    index=paid_df.index,
    columns=paid_df.columns
)


import numpy as np
import pandas as pd
from scipy import stats


def porownaj_rozklady_paid_incurred(
    I, R, E_I, E_R,
    h, g, theta2_I, theta2_R,
    weights_inc,
    weights_R=None,
    max_okres=None,
    n_resamples_ad=100000,
    seed=12345
):
    """
    Ocena dopasowania rozkładów warunkowych Paid-Incurred:
        - normalny
        - gamma
        - lognormalny

    Osobno dla:
        - Incurred
        - rezerw

    Parametry średniej i wariancji są ustalone.
    Nie są ponownie estymowane.

    Testy KS i AD dotyczą reszt PIT względem N(0,1).
    p-value AD wyznaczane metodą Monte Carlo.

    Zwraca:
        tabela_ogolna
        tabela_okresy
        tabela_porownawcza
        reszty_wszystkie
        diagnostyka
    """

    I = np.asarray(I, dtype=np.float64)
    R = np.asarray(R, dtype=np.float64)
    E_I = np.asarray(E_I, dtype=np.float64)
    E_R = np.asarray(E_R, dtype=np.float64)

    h = np.asarray(h, dtype=np.float64)
    g = np.asarray(g, dtype=np.float64)
    theta2_I = np.asarray(theta2_I, dtype=np.float64)
    theta2_R = np.asarray(theta2_R, dtype=np.float64)

    W_I = np.asarray(weights_inc, dtype=np.float64)

    if weights_R is None:
        W_R = W_I.copy()
    else:
        W_R = np.asarray(weights_R, dtype=np.float64)

    a = I.shape[0]

    # ==========================================
    # 1. KONTROLA DANYCH
    # ==========================================

    for name, M in [
        ("I", I),
        ("R", R),
        ("E_I", E_I),
        ("E_R", E_R)
    ]:
        if M.shape != (a, a):
            raise ValueError(
                f"{name} musi mieć wymiar ({a}, {a})."
            )

    for name, x in [
        ("h", h),
        ("g", g),
        ("theta2_I", theta2_I),
        ("theta2_R", theta2_R)
    ]:
        if x.shape != (a - 1,):
            raise ValueError(
                f"Nieprawidłowy wymiar {name}."
            )

    for name, W in [
        ("weights_inc", W_I),
        ("weights_R", W_R)
    ]:
        if W.shape != (a - 1, a - 1):
            raise ValueError(
                f"Nieprawidłowy wymiar {name}."
            )

        if not np.all(np.isin(W, [0, 1])):
            raise ValueError(
                f"{name} musi zawierać 0 lub 1."
            )

    if max_okres is None:
        max_okres = a - 1

    if not 1 <= max_okres <= a - 1:
        raise ValueError("Nieprawidłowy max_okres.")

    if n_resamples_ad is not None:
        if not isinstance(n_resamples_ad, (int, np.integer)):
            raise ValueError("n_resamples_ad musi być całkowite.")

        if n_resamples_ad < 1:
            raise ValueError("n_resamples_ad musi być dodatnie.")

    # ==========================================
    # 2. STATYSTYKA ANDERSONA-DARLINGA
    # ==========================================

    def ad_statistic(z, axis=-1):

        z = np.sort(
            np.asarray(z, dtype=np.float64),
            axis=axis
        )

        n = z.shape[axis]

        log_f = stats.norm.logcdf(z)

        log_sf = stats.norm.logsf(
            np.flip(z, axis=axis)
        )

        k = np.arange(1, n + 1)

        shape = [1] * z.ndim
        shape[axis] = n

        weights = (2 * k - 1).reshape(shape)

        return (
            -n
            - np.sum(
                weights * (log_f + log_sf),
                axis=axis
            ) / n
        )

    # ==========================================
    # 3. TESTY STATYSTYCZNE
    # ==========================================

    def testy(z, rng):

        z = np.asarray(z, dtype=np.float64)

        if len(z) < 2:
            return None

        ks = stats.kstest(
            z,
            "norm",
            args=(0, 1),
            method="auto"
        )

        ad = float(ad_statistic(z))

        if n_resamples_ad is not None:

            mc = stats.monte_carlo_test(
                data=z,
                rvs=lambda size: rng.standard_normal(size),
                statistic=ad_statistic,
                alternative="greater",
                n_resamples=int(n_resamples_ad),
                vectorized=True,
                batch=10000
            )

            p_ad = float(mc.pvalue)

        else:
            p_ad = np.nan

        return {
            "Liczebność próby": len(z),
            "Średnia": np.mean(z),
            "Odchylenie standardowe": np.std(z, ddof=1),
            "Statystyka testowa KS": float(ks.statistic),
            "p-value KS": float(ks.pvalue),
            "Statystyka testowa AD": ad,
            "p-value AD": p_ad
        }

    # ==========================================
    # 4. PRZYGOTOWANIE OBSERWACJI
    # ==========================================

    dane_modeli = {}
    diagnostyka_rows = []

    konfiguracje = [
        ("Incurred", I, E_I, h, theta2_I, W_I),
        ("Rezerwy", R, E_R, g, theta2_R, W_R)
    ]

    for model, X, E, coef, theta2, W in konfiguracje:

        rekordy = []

        for j in range(max_okres):

            n_rows = a - j - 1

            selected = np.flatnonzero(
                W[:n_rows, j] == 1
            )

            if len(selected) == 0:
                diagnostyka_rows.append({
                    "Model": model,
                    "Rok rozwoju": j + 1,
                    "Wybrane wagami": 0,
                    "Do testów": 0,
                    "Wyłączone": 0,
                    "Status": "Brak obserwacji"
                })
                continue

            e = E[selected, j]
            x0 = X[selected, j]
            x1 = X[selected, j + 1]

            # Moment warunkowy:
            # Incurred: I_j + h_j * E_I
            # Rezerwy:  g_j * E_R

            if model == "Incurred":
                mu = x0 + coef[j] * e
            else:
                mu = coef[j] * e

            var = theta2[j] * e

            valid_data = (
                np.isfinite(x0)
                & np.isfinite(x1)
                & np.isfinite(e)
                & np.isfinite(mu)
                & np.isfinite(var)
            )

            valid = (
                valid_data
                & (e > 0)
                & (var > 0)
                & (mu > 0)
            )
            # Reguła odtworzona z wyników referencyjnych zakładu
            if model == "Rezerwy":
                valid = valid & (x1 > 0)
            liczba = int(np.sum(valid))

            if liczba == 0:
                status = "Brak poprawnych momentów"
            elif liczba < 2:
                status = "Zbyt mała próba"
            elif liczba < len(selected):
                status = "Część obserwacji wyłączona"
            else:
                status = "OK"

            diagnostyka_rows.append({
                "Model": model,
                "Rok rozwoju": j + 1,
                "Wybrane wagami": len(selected),
                "Do testów": liczba,
                "Wyłączone": len(selected) - liczba,
                "Zerowa/niedodatnia ekspozycja": int(
                    np.sum(valid_data & (e <= 0))
                ),
                "Niedodatnia wariancja": int(
                    np.sum(valid_data & (var <= 0))
                ),
                "Niedodatnia średnia": int(
                    np.sum(valid_data & (mu <= 0))
                ),
                "Status": status
            })

            for idx in np.flatnonzero(valid):

                rekordy.append({
                    "Indeks roku": int(selected[idx]),
                    "Okres": j + 1,
                    "Obserwacja": x1[idx],
                    "Średnia warunkowa": mu[idx],
                    "Wariancja warunkowa": var[idx]
                })

        dane_modeli[model] = pd.DataFrame(
            rekordy,
            columns=[
                "Indeks roku",
                "Okres",
                "Obserwacja",
                "Średnia warunkowa",
                "Wariancja warunkowa"
            ]
        )

    # ==========================================
    # 5. TRANSFORMACJA PIT
    # ==========================================

    eps = np.finfo(float).eps

    def pit_reszty(dane):

        y = dane["Obserwacja"].to_numpy(dtype=float)
        mu = dane["Średnia warunkowa"].to_numpy(dtype=float)
        var = dane["Wariancja warunkowa"].to_numpy(dtype=float)

        # NORMALNY
        u_normal = stats.norm.cdf(
            y,
            loc=mu,
            scale=np.sqrt(var)
        )

        # GAMMA
        shape_gamma = mu**2 / var
        scale_gamma = var / mu

        u_gamma = stats.gamma.cdf(
            y,
            a=shape_gamma,
            scale=scale_gamma
        )

        # LOGNORMALNY
        sigma_log2 = np.log1p(var / mu**2)
        sigma_log = np.sqrt(sigma_log2)
        mu_log = np.log(mu) - sigma_log2 / 2

        u_lognormal = stats.lognorm.cdf(
            y,
            s=sigma_log,
            scale=np.exp(mu_log)
        )

        res = {}

        for nazwa, u in [
            ("normal", u_normal),
            ("gamma", u_gamma),
            ("lognormal", u_lognormal)
        ]:

            u = np.clip(u, eps, 1.0 - eps)
            res[nazwa] = stats.norm.ppf(u)

        return res

    # ==========================================
    # 6. ANALIZA GLOBALNA I WG OKRESÓW
    # ==========================================

    wiersze_globalne = []
    wiersze_okresy = []
    reszty_lista = []

    rozklady = ["normal", "gamma", "lognormal"]

    for model in ["Incurred", "Rezerwy"]:

        dane = dane_modeli[model]

        if dane.empty:
            continue

        reszty = pit_reszty(dane)

        wynik_reszt = dane[
            ["Indeks roku", "Okres"]
        ].copy()

        wynik_reszt.insert(0, "Model", model)

        for nazwa in rozklady:
            wynik_reszt[nazwa] = reszty[nazwa]

        reszty_lista.append(wynik_reszt)

        for nazwa in rozklady:

            z = np.asarray(reszty[nazwa], dtype=float)
            okresy = dane["Okres"].to_numpy(dtype=int)

            # Globalny test
            if len(z) >= 2:

                rng = np.random.default_rng(seed)

                wynik = testy(z, rng)

                wiersze_globalne.append({
                    "Model": model,
                    "Rozkład": nazwa,
                    **wynik
                })

            # Testy według okresów
            for j in range(1, max_okres + 1):

                z_j = z[okresy == j]

                if len(z_j) < 2:
                    continue

                rng_j = np.random.default_rng(
                    np.random.SeedSequence([
                        seed,
                        0 if model == "Incurred" else 1,
                        rozklady.index(nazwa),
                        j
                    ])
                )

                wynik = testy(z_j, rng_j)

                wiersze_okresy.append({
                    "Model": model,
                    "Rok rozwoju": j,
                    "Rozkład": nazwa,
                    **wynik
                })

    # ==========================================
    # 7. TABELE WYNIKOWE
    # ==========================================

    tabela_porownawcza = pd.DataFrame(
        wiersze_globalne
    )

    if not tabela_porownawcza.empty:
        tabela_porownawcza = (
            tabela_porownawcza
            .sort_values(["Model", "Rozkład"])
            .reset_index(drop=True)
        )

    tabela_ogolna = tabela_porownawcza.copy()

    tabela_okresy = pd.DataFrame(
        wiersze_okresy
    )

    if not tabela_okresy.empty:
        tabela_okresy = (
            tabela_okresy
            .sort_values(
                ["Model", "Rok rozwoju", "Rozkład"]
            )
            .reset_index(drop=True)
        )

    reszty_wszystkie = (
        pd.concat(reszty_lista, ignore_index=True)
        if reszty_lista
        else pd.DataFrame()
    )

    diagnostyka = pd.DataFrame(
        diagnostyka_rows
    )

    # Liczba obserwacji poza nośnikiem
    # rozkładów gamma i lognormalnego
    if not reszty_wszystkie.empty:

        for model in ["Incurred", "Rezerwy"]:

            dane = dane_modeli[model]

            if dane.empty:
                continue

            for j in range(1, max_okres + 1):

                fragment = dane[dane["Okres"] == j]

                mask_diag = (
                    (diagnostyka["Model"] == model)
                    & (diagnostyka["Rok rozwoju"] == j)
                )

                diagnostyka.loc[
                    mask_diag,
                    "Obserwacje <= 0 przy dodatnich momentach"
                ] = int(
                    np.sum(fragment["Obserwacja"] <= 0)
                )

    return (
        tabela_ogolna,
        tabela_okresy,
        tabela_porownawcza,
        reszty_wszystkie,
        diagnostyka
    )



