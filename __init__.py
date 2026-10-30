import numpy as np
import pandas as pd


def parametry_rozkladow_MM(srednia, odchylenie):
    m = float(srednia)
    v = float(odchylenie) ** 2

    sigma_log = np.sqrt(np.log1p(v / m ** 2))
    mu_log = np.log(m) - sigma_log ** 2 / 2

    return pd.DataFrame({
        "Rozklad": ["Normal", "Gamma", "LogNormal"],
        "Metoda": ["MM", "MM", "MM"],
        "Parametry": [
            {"mu": m, "sigma": float(odchylenie)},
            {"alpha": m ** 2 / v, "beta": v / m},
            {"mu": mu_log, "sigma": sigma_log},
        ],
    })


parametry_SEV_AC = parametry_rozkladow_MM(
    srednia=.,
    odchylenie=,
)

display(parametry_SEV_AC)
