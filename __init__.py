import numpy as np
import pandas as pd

def tabela_reszt(wynik, lata):
    y = np.asarray(wynik["srednie"], dtype=float)
    trend = np.asarray(wynik["trend"], dtype=float)
    lata = np.asarray(lata)

    if y.ndim != 1 or trend.shape != y.shape or lata.shape != y.shape:
        raise ValueError("Lata, średnie i trend muszą mieć tę samą długość.")

    reszty = y - trend

    return pd.DataFrame({
        "YEAR": lata,
        "AC_Ave": y,
        "Trend": trend,
        "Reszta": reszty,
        "Reszta_kwadrat": reszty ** 2,
    })


# wynik_trendu — wynik wcześniejszego wywołania licz_trend(...)
reszty_df = tabela_reszt(
    wynik=wynik_trendu,
    lata=np.arange(2007, 2025),
)

display(reszty_df)
