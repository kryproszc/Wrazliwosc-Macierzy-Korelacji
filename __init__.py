import numpy as np
import pandas as pd
from scipy import stats

parametry = SEV_AC.set_index("Rozklad")["Parametry"]

normal = stats.norm(
    loc=parametry["Normal"]["mu"],
    scale=parametry["Normal"]["sigma"],
)

gamma = stats.gamma(
    a=parametry["Gamma"]["alpha"],
    scale=parametry["Gamma"]["beta"],
)

lognormal = stats.lognorm(
    s=parametry["LogNormal"]["sigma"],
    scale=np.exp(parametry["LogNormal"]["mu"]),
)

n = 10000
rng = np.random.default_rng(324)


obs_normal = normal.rvs(size=n, random_state=rng)
obs_gamma = gamma.rvs(size=n, random_state=rng)
obs_lognormal = lognormal.rvs(size=n, random_state=rng)


def statystyki_obserwacji(obserwacje):
    x = np.asarray(obserwacje, dtype=float)
    poziomy = np.array([
        0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
        0.95, 0.99, 0.995, 0.999,
    ])

    return pd.Series({
        "min": np.min(x),
        "max": np.max(x),
        **{
            f"q_{p:g}": q
            for p, q in zip(poziomy, np.quantile(x, poziomy))
        },
    })


statystyki_SEV_AC = pd.DataFrame({
    "Normal": statystyki_obserwacji(obs_normal),
    "Gamma": statystyki_obserwacji(obs_gamma),
    "LogNormal": statystyki_obserwacji(obs_lognormal),
}).T

display(statystyki_SEV_AC)

def statystyka_AD(obserwacje, rozklad):
    x = np.sort(np.asarray(obserwacje, dtype=float), axis=-1)
    n = x.shape[-1]
    i = np.arange(1, n + 1)

    return -n - np.sum(
        (2 * i - 1) * (
            rozklad.logcdf(x)
            + rozklad.logsf(x[..., ::-1])
        ),
        axis=-1,
    ) / n


def testy_KS_AD(
    obserwacje,
    rozklad,
    n_resamples=10000,
    seed=324,
    batch_size=100,
):
    x = np.asarray(obserwacje, dtype=float)
    rng = np.random.default_rng(seed)

    ks = stats.kstest(x, rozklad.cdf, method="exact")
    ad = statystyka_AD(x, rozklad)

    przekroczenia = 0

    for start in range(0, n_resamples, batch_size):
        liczba_prob = min(batch_size, n_resamples - start)

        proby = rozklad.rvs(
            size=(liczba_prob, len(x)),
            random_state=rng,
        )

        ad_symulowane = statystyka_AD(proby, rozklad)
        przekroczenia += np.count_nonzero(ad_symulowane >= ad)

    return pd.Series({
        "KS_statystyka": ks.statistic,
        "KS_p_value_klasyczne": ks.pvalue,
        "AD_statystyka": float(ad),
        "AD_p_value_MC_stale_parametry": (
            przekroczenia + 1
        ) / (n_resamples + 1),
    })
