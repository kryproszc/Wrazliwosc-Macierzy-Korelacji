import numpy as np


def utworz_wagi(nb_triangle, ostatnie=None):

    t = np.asarray(nb_triangle, dtype=float)

    if t.ndim != 2 or t.shape[1] < 2:
        raise ValueError("Trójkąt musi mieć co najmniej dwie kolumny.")

    if ostatnie is not None:
        if not isinstance(ostatnie, (int, np.integer)) or ostatnie < 1:
            raise ValueError("ostatnie musi być dodatnią liczbą całkowitą.")

    # Para jest dostępna, gdy znamy obie jej wartości.
    dostepne = np.isfinite(t[:, :-1]) & np.isfinite(t[:, 1:])
    wagi = np.zeros(dostepne.shape, dtype=float)

    for j in range(wagi.shape[1]):
        wiersze = np.flatnonzero(dostepne[:, j])

        if ostatnie is not None:
            wiersze = wiersze[-ostatnie:]

        wagi[wiersze, j] = 1.0

    return wagi


def policz_ldf(nb_triangle, wagi):
    t = np.asarray(nb_triangle, dtype=float)
    w = np.asarray(wagi, dtype=float)

    if t.ndim != 2 or t.shape[1] < 2:
        raise ValueError("Trójkąt musi mieć co najmniej dwie kolumny.")

    if w.shape != (t.shape[0], t.shape[1] - 1):
        raise ValueError(
            f"Wagi powinny mieć wymiar "
            f"{(t.shape[0], t.shape[1] - 1)}."
        )

    if np.any(~np.isfinite(w)) or np.any(w < 0):
        raise ValueError("Wagi muszą być skończone i nieujemne.")

    x = t[:, :-1]
    y = t[:, 1:]
    dostepne = np.isfinite(x) & np.isfinite(y)

    if np.any((w > 0) & ~dostepne):
        raise ValueError("Dodatnia waga wskazuje parę z brakującymi danymi.")

    # Zastępujemy braki przed mnożeniem: 0 * nan nadal daje nan.
    x = np.where(dostepne, x, 0.0)
    y = np.where(dostepne, y, 0.0)

    licznik = np.sum(w * y, axis=0)
    mianownik = np.sum(w * x, axis=0)

    ldf = np.full(t.shape[1] - 1, np.nan)
    np.divide(
        licznik,
        mianownik,
        out=ldf,
        where=mianownik != 0,
    )

    return ldf

wagi = utworz_wagi(nb_triangle, ostatnie=5)


ldf = policz_ldf(nb_triangle, wagi)

print("Wagi:")
print(wagi)

print("LDF:")
print(ldf)

