from pathlib import Path

import numpy as np
from openpyxl import load_workbook


def wczytaj_trojkat(folder, plik, zakres, arkusz="Nb_triangle"):
    """
    Zakres obejmuje wyłącznie wartości:
    bez kolumny lat i bez nagłówków okresów rozwoju.

    Układ: najstarszy rok na górze, rozwój od lewej do prawej.
    """
    wb = load_workbook(
        Path(folder) / plik,
        data_only=True,
        read_only=True,
    )

    try:
        ws = wb[arkusz]

        trojkat = np.array(
            [
                [np.nan if c.value is None else float(c.value)
                 for c in wiersz]
                for wiersz in ws[zakres]
            ],
            dtype=float,
        )
    finally:
        wb.close()

    n, m = trojkat.shape

    if n != m:
        raise ValueError(
            f"Zakres {zakres} ma rozmiar {n} × {m}. "
            "Wybierz zakres kwadratowy."
        )

    # Część obserwowana wraz z przekątną aktuarialną.
    i, j = np.indices((n, n))
    maska = i + j < n

    return np.where(maska, trojkat, np.nan)


nb_triangle = wczytaj_trojkat(
    folder=folder,
    plik=plik,
    arkusz="Nb_triangle",
    zakres="B2:S19",
)

print(nb_triangle)
