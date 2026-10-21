

def przygotuj_df_reszty(C):
 
    dane = []

    for i in range(C.shape[0]):
        for j in range(C.shape[1] - 1):

            c0 = C[i, j]
            c1 = C[i, j + 1]

            if not (np.isfinite(c0) and np.isfinite(c1)):
                continue

            dane.append({
                "Indeks roku": i + 1,
                "Okres": j + 1,
                "C_ij": c0,
                "C_ij1": c1
            })

    return dane


import numpy as np
import pandas as pd
from scipy import stats


def wyniki_rozkladow_mack(
    triangle,
    ldf,
    sigma2,
    max_okres=8,
    n_resamples_ad=100000,
    seed=12345
):
    C = np.asarray(triangle, dtype=float)
    ldf = np.asarray(ldf, dtype=float).ravel()
    sigma2 = np.asarray(sigma2, dtype=float).ravel()

    if C.ndim != 2:
        raise ValueError("Trójkąt musi być dwuwymiarowy.")

    if not 1 <= max_okres < C.shape[1]:
        raise ValueError("Nieprawidłowy max_okres.")

    if max_okres > len(ldf) or max_okres > len(sigma2):
        raise ValueError("Za mało parametrów LDF lub sigma2.")

    if n_resamples_ad is not None and n_resamples_ad < 1:
        raise ValueError("n_resamples_ad musi być dodatnie.")

    # 1. Dane z trójkąta
    dane = []

    for j in range(max_okres):
        for i in range(C.shape[0]):

            c0 = C[i, j]
            c1 = C[i, j + 1]

            if not (np.isfinite(c0) and np.isfinite(c1)):
                continue

            mu = c0 * ldf[j]
            var = c0 * sigma2[j]

            if not (np.isfinite(mu) and np.isfinite(var)):
                continue

            if mu <= 0 or var <= 0:
                continue

            dane.append({
                "Indeks roku": i + 1,
                "Okres": j + 1,
                "C_ij": c0,
                "C_ij1": c1,
                "mu": mu,
                "var": var
            })

    df = pd.DataFrame(dane)

    if df.empty:
        raise ValueError("Brak obserwacji do analizy.")

    mu = df["mu"].to_numpy()
    var = df["var"].to_numpy()
    y = df["C_ij1"].to_numpy()
    okres = df["Okres"].to_numpy()

    # 2. Dystrybuanty warunkowe

    u_normal = stats.norm.cdf(
        y, loc=mu, scale=np.sqrt(var)
    )

    shape_gamma = mu**2 / var
    scale_gamma = var / mu

    u_gamma = stats.gamma.cdf(
        y, a=shape_gamma, scale=scale_gamma
    )

    sigma_log2 = np.log1p(var / mu**2)
    sigma_log = np.sqrt(sigma_log2)
    mu_log = np.log(mu) - sigma_log2 / 2

    u_lognormal = stats.lognorm.cdf(
        y, s=sigma_log, scale=np.exp(mu_log)
    )

    # 3. Reszty PIT

    eps = np.finfo(float).eps

    def pit_reszty(u):
        u = np.clip(u, eps, 1.0 - eps)
        return stats.norm.ppf(u)

    reszty = {
        "normal": pit_reszty(u_normal),
        "gamma": pit_reszty(u_gamma),
        "lognormal": pit_reszty(u_lognormal)
    }

    # 4. Statystyka Andersona-Darlinga

    def ad_statistic(z, axis=-1):

        z = np.sort(
            np.asarray(z, dtype=float),
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

        return -n - np.sum(
            weights * (log_f + log_sf),
            axis=axis
        ) / n

    # 5. Testy KS i AD

    def testy(z, rng):

        z = np.asarray(z, dtype=float)

        ks = stats.kstest(
            z, "norm", args=(0, 1),
            method="auto"
        )

        ad = float(ad_statistic(z))

        if n_resamples_ad is not None:

            mc = stats.monte_carlo_test(
                data=z,
                rvs=lambda size: rng.standard_normal(size),
                statistic=ad_statistic,
                alternative="greater",
                n_resamples=n_resamples_ad,
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
            "Statystyka testowa KS": ks.statistic,
            "p-value KS": ks.pvalue,
            "Statystyka testowa AD": ad,
            "p-value AD": p_ad
        }

    # 6. Wyniki dla każdego rozkładu

    wyniki = {}

    for nazwa, z in reszty.items():

        rng = np.random.default_rng(seed)

        ogolne = testy(z, rng)

        tabela_ogolna = pd.DataFrame({
            "Miara": list(ogolne.keys()),
            "Wartość": list(ogolne.values())
        })

        wiersze = []

        for j in range(1, max_okres + 1):

            z_j = z[okres == j]

            if len(z_j) < 2:
                continue

            wiersze.append({
                "Rok rozwoju": j,
                **testy(z_j, rng)
            })

        tabela_okresy = pd.DataFrame(wiersze)

        wyniki[nazwa] = {
            "ogolna": tabela_ogolna,
            "okresy": tabela_okresy
        }

    return wyniki


###################################

##########3


import numpy as np
import pandas as pd
from scipy import stats


def wyniki_rozkladow_mack(
    triangle,
    ldf,
    sigma2,
    wagi,
    max_okres=8,
    n_resamples_ad=100000,
    seed=12345
):
    """
    Porównanie trzech rozkładów warunkowych modelu Macka:
    - normalnego
    - gamma
    - lognormalnego

    Uwzględnia tylko obserwacje z wagą równą 1.

    Zwraca dla każdego rozkładu:
    - tabelę ogólną
    - tabelę według okresów rozwoju
    """

    C = np.asarray(triangle, dtype=float)
    W = np.asarray(wagi, dtype=float)
    ldf = np.asarray(ldf, dtype=float).ravel()
    sigma2 = np.asarray(sigma2, dtype=float).ravel()

    if C.ndim != 2 or W.ndim != 2:
        raise ValueError("Trójkąt i wagi muszą być dwuwymiarowe.")

    if W.shape != (C.shape[0] - 1, C.shape[1] - 1):
        raise ValueError(
            f"Nieprawidłowy wymiar wag: {W.shape}. "
            f"Oczekiwano {(C.shape[0]-1, C.shape[1]-1)}."
        )

    if not 1 <= max_okres <= W.shape[1]:
        raise ValueError("Nieprawidłowy max_okres.")

    if max_okres > len(ldf) or max_okres > len(sigma2):
        raise ValueError("Za mało parametrów LDF lub sigma2.")

    # ==========================================
    # 1. PRZYGOTOWANIE OBSERWACJI Z WAGAMI
    # ==========================================

    dane = []

    for j in range(max_okres):
        for i in range(W.shape[0]):

            # Uwzględniamy wyłącznie wagę 1
            if not np.isfinite(W[i, j]) or W[i, j] != 1:
                continue

            c0 = C[i, j]
            c1 = C[i, j + 1]

            if not (np.isfinite(c0) and np.isfinite(c1)):
                continue

            mu = c0 * ldf[j]
            var = c0 * sigma2[j]

            if not (np.isfinite(mu) and np.isfinite(var)):
                continue

            if mu <= 0 or var <= 0:
                continue

            dane.append({
                "Rok": i + 1,
                "Okres": j + 1,
                "C_ij": c0,
                "C_ij1": c1,
                "mu": mu,
                "var": var
            })

    df = pd.DataFrame(dane)

    if df.empty:
        raise ValueError("Brak obserwacji do analizy.")

    y = df["C_ij1"].to_numpy(dtype=float)
    mu = df["mu"].to_numpy(dtype=float)
    var = df["var"].to_numpy(dtype=float)
    okres = df["Okres"].to_numpy(dtype=int)

    # ==========================================
    # 2. DYSTRYBUANTY TRZECH ROZKŁADÓW
    # ==========================================

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

    # ==========================================
    # 3. RESZTY PIT
    # ==========================================

    eps = np.finfo(float).eps

    def pit(u):
        return stats.norm.ppf(
            np.clip(u, eps, 1.0 - eps)
        )

    reszty = {
        "normal": pit(u_normal),
        "gamma": pit(u_gamma),
        "lognormal": pit(u_lognormal)
    }

    # ==========================================
    # 4. STATYSTYKA ANDERSONA-DARLINGA
    # ==========================================

    def ad_statistic(z, axis=-1):

        z = np.sort(
            np.asarray(z, dtype=float),
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

        return -n - np.sum(
            weights * (log_f + log_sf),
            axis=axis
        ) / n

    # ==========================================
    # 5. TESTY KS I AD
    # ==========================================

    def testy(z, rng):

        z = np.asarray(z, dtype=float)

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
                n_resamples=n_resamples_ad,
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
            "Statystyka testowa KS": ks.statistic,
            "p-value KS": ks.pvalue,
            "Statystyka testowa AD": ad,
            "p-value AD": p_ad
        }

    # ==========================================
    # 6. TABELE WYNIKOWE
    # ==========================================

    wyniki = {}

    for nazwa, z in reszty.items():

        rng = np.random.default_rng(seed)

        # Wyniki łączne
        ogolne = testy(z, rng)

        tabela_ogolna = pd.DataFrame({
            "Miara": list(ogolne.keys()),
            "Wartość": list(ogolne.values())
        })

        # Wyniki według okresów rozwoju
        wiersze = []

        for j in range(1, max_okres + 1):

            z_j = z[okres == j]

            if len(z_j) < 2:
                continue

            wiersze.append({
                "Rok rozwoju": j,
                **testy(z_j, rng)
            })

        tabela_okresy = pd.DataFrame(wiersze)

        wyniki[nazwa] = {
            "ogolna": tabela_ogolna,
            "okresy": tabela_okresy
        }

    return wyniki


wyniki = wyniki_rozkladow_mack(
    triangle=triangle,
    ldf=LDF_zaklad,
    sigma2=sigma2_fit,
    wagi=wagi,
    max_okres=8,
    n_resamples_ad=100000,
    seed=12345
)

for rozklad in ["normal", "gamma", "lognormal"]:

    print(f"\nROZKŁAD: {rozklad.upper()}")

    display(wyniki[rozklad]["ogolna"])
    display(wyniki[rozklad]["okresy"])


import pandas as pd

def porownanie_dla_k(
    triangle,
    ldf,
    sigma2,
    wagi,
    max_k=10,
    n_resamples_ad=100000,
    seed=12345
):
    """
    Generuje tabele porównawcze trzech rozkładów
    dla k = 1, 2, ..., max_k.

    Każda tabela uwzględnia pierwszych k
    okresów rozwoju łącznie.
    """

    wszystkie_tabele = {}

    for k in range(1, max_k + 1):

        wyniki = wyniki_rozkladow_mack(
            triangle=triangle,
            ldf=ldf,
            sigma2=sigma2,
            wagi=wagi,
            max_okres=k,
            n_resamples_ad=n_resamples_ad,
            seed=seed
        )

        tabela = pd.DataFrame({
            "Miara": wyniki["normal"]["ogolna"]["Miara"],
            "Normalny": wyniki["normal"]["ogolna"]["Wartość"],
            "Gamma": wyniki["gamma"]["ogolna"]["Wartość"],
            "Lognormalny": wyniki["lognormal"]["ogolna"]["Wartość"]
        })

        wszystkie_tabele[k] = tabela

    return wszystkie_tabele


tabele_k = porownanie_dla_k(
    triangle=triangle,
    ldf=LDF_zaklad,
    sigma2=sigma2_fit,
    wagi=wagi,
    max_k=15,
    n_resamples_ad=1000,
    seed=12345
)

for k, tabela in tabele_k.items():
    print(f"\nK = {k} — pierwszych {k} okresów rozwoju")
    display(tabela)



