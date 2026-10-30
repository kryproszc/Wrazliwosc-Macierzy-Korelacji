import numpy as np
import pandas as pd
from scipy import stats


def testy_sev_z_trendem(
    wynik_trendu,
    phi_hat_0,
    phi_hat_2,
    n_resamples=10000,
    seed=324,
):
    y = np.asarray(wynik_trendu["srednie"], dtype=float)
    mu_t = np.asarray(wynik_trendu["trend"], dtype=float)
    n = len(y)

    sigma_log = np.sqrt(np.log1p(phi_hat_2))

    rozklady = {
        "Normal": stats.norm(
            loc=mu_t,
            scale=np.sqrt(phi_hat_0),
        ),
        "Gamma": stats.gamma(
            a=1 / phi_hat_2,
            scale=mu_t * phi_hat_2,
        ),
        "LogNormal": stats.lognorm(
            s=sigma_log,
            scale=mu_t / np.sqrt(1 + phi_hat_2),
        ),
    }

    def statystyka_ad(z):
        z = np.sort(z, axis=-1)
        i = np.arange(1, n + 1)

        return -n - np.sum(
            (2 * i - 1) * (
                stats.norm.logcdf(z)
                + stats.norm.logsf(z[..., ::-1])
            ),
            axis=-1,
        ) / n

    rng = np.random.default_rng(seed)
    proby = rng.standard_normal((n_resamples, n))
    ad_symulowane = statystyka_ad(proby)

    wyniki = []

    for nazwa, rozklad in rozklady.items():
        u = rozklad.cdf(y)
        u = np.clip(u, 1e-15, 1 - 1e-15)
        z = stats.norm.ppf(u)

        ks = stats.kstest(z, "norm", method="exact")
        ad = statystyka_ad(z)

        wyniki.append({
            "Rozklad": nazwa,
            "KS_statystyka": ks.statistic,
            "KS_p_value_klasyczne": ks.pvalue,
            "AD_statystyka": float(ad),
            "AD_p_value_MC_stale_parametry": (
                1 + np.count_nonzero(ad_symulowane >= ad)
            ) / (n_resamples + 1),
        })

    return pd.DataFrame(wyniki)


testy_SEV_AC = testy_sev_z_trendem(
    wynik_trendu=wynik_trendu,
    phi_hat_0=estimated_params_sev_z_trendem.loc[0, "phi_hat_0"],
    phi_hat_2=estimated_params_sev_z_trendem.loc[0, "phi_hat_2"],
)

display(testy_SEV_AC)
