import numpy as np
import pandas as pd


def parametry_rozkladow_MM(srednia, sd_normal, sd_gamma_lognormal):
    m = float(srednia)
    v = float(sd_gamma_lognormal) ** 2

    sigma_log = np.sqrt(np.log1p(v / m ** 2))
    mu_log = np.log(m) - sigma_log ** 2 / 2

    return pd.DataFrame({
        "Rozklad": ["Normal", "Gamma", "LogNormal"],
        "Metoda": ["MM", "MM", "MM"],
        "Srednia": [m, m, m],
        "Odchylenie": [sd_normal, sd_gamma_lognormal, sd_gamma_lognormal],
        "Parametry": [
            {"mu": m, "sigma": float(sd_normal)},
            {"alpha": m ** 2 / v, "beta": v / m},
            {"mu": mu_log, "sigma": sigma_log},
        ],
    })
