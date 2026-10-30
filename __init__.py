import numpy as np
import pandas as pd
from scipy import stats


def dopasuj_lognormal(dane, shift=0):
    x = np.asarray(dane, dtype=float)

    sigma, _, skala = stats.lognorm.fit(
        x - shift,
        floc=0,
        method="MLE",
    )

    mu = np.log(skala)
    rozklad = stats.lognorm(s=sigma, loc=shift, scale=skala)

    return pd.DataFrame({
        "Rozklad": ["LogNormal"],
        "Metoda": ["MLE"],
        "shift": [shift],
        "mu": [mu],
        "sigma": [sigma],
        "Srednia_empiryczna": [np.mean(x)],
        "Srednia_rozkladu": [rozklad.mean()],
        "SD_empiryczne": [np.std(x, ddof=1)],
        "SD_rozkladu": [rozklad.std()],
        "Liczba_obserwacji": [len(x)],
    }), rozklad

parametry_LN_LC, rozklad_LN_LC = dopasuj_lognormal(
    dane=Am_ult_ic,
    shift=0,
)

display(parametry_LN_LC)
