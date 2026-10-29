import numpy as np
import pandas as pd


def wspolczynniki_ia(cumulative_df, ekspozycja, wagi=None):
    """Współczynniki IA ze skumulowanego trójkąta NumPy."""
    C = np.asarray(cumulative_df, dtype=float)
    expo = np.asarray(ekspozycja, dtype=float).reshape(-1)

    if C.ndim != 2:
        raise ValueError("Trójkąt musi być tablicą dwuwymiarową.")

    if len(expo) != C.shape[0]:
        raise ValueError("Liczba ekspozycji musi odpowiadać liczbie wierszy.")

    if not np.all(np.isfinite(expo)) or np.any(expo <= 0):
        raise ValueError("Ekspozycje muszą być skończone i dodatnie.")

    # Jeśli nie podano wag — wszędzie przyjmujemy 1.
    W = (
        np.ones_like(C)
        if wagi is None
        else np.asarray(wagi, dtype=float)
    )

    if W.shape != C.shape:
        raise ValueError("Wagi muszą mieć taki sam wymiar jak trójkąt.")

    # Zamiana danych skumulowanych na przyrostowe.
    I = np.full_like(C, np.nan)
    I[:, 0] = C[:, 0]
    I[:, 1:] = C[:, 1:] - C[:, :-1]

    obserwowane = ~np.isnan(C)

    if np.any(obserwowane & ~np.isfinite(I)):
        raise ValueError("Sprawdź brakujące dane wewnątrz trójkąta.")

    if (
        not np.all(np.isfinite(W[obserwowane]))
        or np.any(W[obserwowane] < 0)
    ):
        raise ValueError("Wagi obserwowanych komórek muszą być poprawne i nieujemne.")

    # Przyszłe komórki pomijamy również w mianowniku.
    W_obs = np.where(obserwowane, W, 0.0)
    I_obs = np.where(obserwowane, I, 0.0)

    licznik = np.sum(I_obs * W_obs, axis=0)
    mianownik = np.sum(expo[:, None] * W_obs, axis=0)

    if np.any(mianownik == 0):
        raise ValueError("Zerowy mianownik dla co najmniej jednego okresu.")

    return licznik / mianownik


def ultimate_ia(cumulative_df, ekspozycja, f_ia):
    """Reported, IBNR i ultimate na podstawie gotowych współczynników IA."""
    C = np.asarray(cumulative_df, dtype=float)
    expo = np.asarray(ekspozycja, dtype=float).reshape(-1)
    f = np.asarray(f_ia, dtype=float).reshape(-1)

    if C.ndim != 2:
        raise ValueError("Trójkąt musi być tablicą dwuwymiarową.")

    if len(expo) != C.shape[0] or len(f) != C.shape[1]:
        raise ValueError("Niezgodne wymiary trójkąta, ekspozycji lub współczynników.")

    if not np.all(np.isfinite(expo)) or not np.all(np.isfinite(f)):
        raise ValueError("Ekspozycje i współczynniki muszą być skończone.")

    wyniki = np.empty((C.shape[0], 3))

    for i, row in enumerate(C):
        pozycje = np.flatnonzero(~np.isnan(row))

        if len(pozycje) == 0:
            raise ValueError(f"Brak obserwacji w wierszu {i}.")

        ostatnia = pozycje[-1]

        if not np.all(np.isfinite(row[:ostatnia + 1])):
            raise ValueError(f"Brak lub niepoprawna wartość wewnątrz wiersza {i}.")

        # Ostatnia obserwowana wartość SKUMULOWANA.
        reported = row[ostatnia]

        # Przyszłe przyrosty = ekspozycja × współczynniki IA.
        ibnr = expo[i] * np.sum(f[ostatnia + 1:])
        ultimate = reported + ibnr

        wyniki[i] = [reported, ibnr, ultimate]

    # Kolumny: Reported, IBNR, Ultimate.
    return wyniki


# ============================================================
# WYWOŁANIE — ekspozycje w tej samej kolejności lat co trójkąt
# ============================================================

ekspozycja = np.asarray(
    dane["ekspozycja"]["wartosc"], dtype=float
).reshape(-1)

# 1. Współczynniki IA BEZ WAG — domyślnie wszystkie wagi = 1.
f_ia = wspolczynniki_ia(
    cumulative_df=LC_Nb_triangle,
    ekspozycja=ekspozycja,
)

# Jeśli chcesz zastosować własne wagi, zamiast powyższego:
# f_ia = wspolczynniki_ia(
#     cumulative_df=LC_Nb_triangle,
#     ekspozycja=ekspozycja,
#     wagi=wagi_Nb_triangle,
# )

display(pd.Series(f_ia, name="f_IA"))

# 2. Ultimate — osobno, z gotowych współczynników.
wyniki_ia = ultimate_ia(
    cumulative_df=LC_Nb_triangle,
    ekspozycja=ekspozycja,
    f_ia=f_ia,
)

display(pd.DataFrame(
    wyniki_ia,
    columns=["Reported", "IBNR", "Ultimate"],
))

# Osobne tablice NumPy:
lc_nb_rep = wyniki_ia[:, 0]
lc_nb_ibnr = wyniki_ia[:, 1]
lc_nb_ult = wyniki_ia[:, 2]
