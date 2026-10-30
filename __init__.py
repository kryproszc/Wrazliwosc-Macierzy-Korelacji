import numpy as np
import pandas as pd
from scipy import stats, optimize


def dopasuj_loggamma(
    dane,
    x_min=-np.inf,
    x_max=np.inf,
    shift=0,
):
    x = np.asarray(dane, dtype=float)

    if (
        x.ndim != 1
        or len(x) == 0
        or not np.all(np.isfinite(x))
        or x_min >= x_max
        or np.any(x < x_min)
        or np.any(x > x_max)
        or np.any(x - shift <= 1)
    ):
        raise ValueError(
            "Dane muszą być skończonym wektorem w zadanym przedziale "
            "i spełniać x > shift + 1."
        )

    z = np.log(x - shift)
    dol = np.log(max(1.0, x_min - shift))
    gora = np.log(x_max - shift)

    alpha_start, _, beta_start = stats.gamma.fit(z, floc=0)

    def minus_loglik(theta):
        alpha, beta = np.exp(theta)

        log_s_dol = stats.gamma.logsf(dol, a=alpha, scale=beta)
        log_s_gora = stats.gamma.logsf(gora, a=alpha, scale=beta)

        with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
            log_masa = log_s_dol + np.log(
                -np.expm1(log_s_gora - log_s_dol)
            )

            log_gestosc = (
                stats.gamma.logpdf(z, a=alpha, scale=beta)
                - np.log(x - shift)
            )

            wynik = -np.sum(log_gestosc) + len(x) * log_masa

        return wynik if np.isfinite(wynik) else np.inf

    wynik = optimize.minimize(
        minus_loglik,
        x0=np.log([alpha_start, beta_start]),
        method="Nelder-Mead",
        options={
            "maxiter": 20000,
            "xatol": 1e-9,
            "fatol": 1e-9,
        },
    )

    alpha, beta = np.exp(wynik.x)

    return pd.DataFrame({
        "Rozklad": ["LogGamma"],
        "Metoda": ["MLE"],
        "x_min": [x_min],
        "x_max": [x_max],
        "shift": [shift],
        "alpha": [alpha],
        "beta_skala": [beta],
        "LogLik": [-wynik.fun],
        "Zbieznosc": [wynik.success],
        "Liczba_obserwacji": [len(x)],
    })


parametry_loggamma_LC = dopasuj_loggamma(
    dane=Am_ult_ic_stand,
    x_min=,
    x_max=10,
    shift=0,
)

display(parametry_loggamma_LC)
