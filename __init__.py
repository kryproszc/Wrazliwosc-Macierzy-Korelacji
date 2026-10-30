import numpy as np
import pandas as pd


def parametry_rozkladow_MM(srednia, phi_hat_0, phi_hat_2):
    m = float(srednia)

    sd_normal = np.sqrt(phi_hat_0)
    sd_gamma_lognormal = m * np.sqrt(phi_hat_2)

    sigma_log = np.sqrt(np.log1p(phi_hat_2))
    mu_log = np.log(m) - sigma_log ** 2 / 2

    return pd.DataFrame({
        "Rozklad": ["Normal", "Gamma", "LogNormal"],
        "Metoda": ["MM", "MM", "MM"],
        "Srednia": [m, m, m],
        "Odchylenie": [
            sd_normal,
            sd_gamma_lognormal,
            sd_gamma_lognormal,
        ],
        "Parametry": [
            {"mu": m, "sigma": sd_normal},
            {"alpha": 1 / phi_hat_2, "beta": m * phi_hat_2},
            {"mu": mu_log, "sigma": sigma_log},
        ],
    })
