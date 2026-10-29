import numpy as np
import pandas as pd


def wspolczynniki_ia(cumulative_df, ekspozycja, wagi):
    # Zamiana trójkąta skumulowanego na przyrostowy
    incremental_df = cumulative_df.diff(axis=1)
    incremental_df.iloc[:, 0] = cumulative_df.iloc[:, 0]

    expo = pd.Series(
        ekspozycja, index=cumulative_df.index, dtype=float
    )

    W = pd.DataFrame(
        wagi,
        index=cumulative_df.index,
        columns=cumulative_df.columns,
        dtype=float,
    )

    # Uwzględniamy tylko obserwowane komórki
    W = W.where(incremental_df.notna(), 0.0)

    licznik = (incremental_df.fillna(0.0) * W).sum(axis=0)
    mianownik = W.mul(expo, axis=0).sum(axis=0)

    if (mianownik == 0).any():
        raise ValueError("Zerowy mianownik przy wyznaczaniu IA.")

    return (licznik / mianownik).rename("f_IA")


def ultimate_ia(cumulative_df, ekspozycja, f_ia):
    expo = pd.Series(
        ekspozycja, index=cumulative_df.index, dtype=float
    )
    f = f_ia.reindex(cumulative_df.columns)

    if f.isna().any():
        raise ValueError("Brakuje współczynników IA.")

    wyniki = []

    for rok, row in cumulative_df.iterrows():
        pozycje = np.flatnonzero(row.notna().to_numpy())

        if len(pozycje) == 0:
            raise ValueError(f"Brak obserwacji dla roku {rok}.")

        ostatnia = pozycje[-1]

        # Ostatnia obserwowana wartość skumulowana
        reported = row.iloc[ostatnia]

        # Suma przyszłych przyrostów
        ibnr = expo.loc[rok] * f.iloc[ostatnia + 1:].sum()

        wyniki.append([reported, ibnr, reported + ibnr])

    return pd.DataFrame(
        wyniki,
        index=cumulative_df.index,
        columns=["Reported", "IBNR", "Ultimate"],
    )



wyniki_ia = ultimate_ia(
    cumulative_df=lc_nb_cumulative_df,
    ekspozycja=ekspozycja,
    f_ia=f_ia,
)

display(wyniki_ia)

