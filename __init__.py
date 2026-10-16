
# ==========================================
# 1. OBLICZENIA — TRZY ROZKŁADY
# ==========================================

(
    tabela_ogolna,
    tabela_okresy,
    tabela_porownawcza,
    reszty_wszystkie,
    diagnostyka
) = porownaj_rozklady_paid_incurred(
    I=I,
    R=R,
    E_I=E_I,
    E_R=E_R,
    h=h,
    g=g,
    theta2_I=theta2_I,
    theta2_R=theta2_R,
    weights_inc=weights_inc,
    max_okres=5,
    n_resamples_ad=100000,
    seed=12345
)

# ==========================================
# 2. WYNIKI GLOBALNE
# ==========================================

print("PORÓWNANIE TRZECH ROZKŁADÓW — GLOBALNIE")
display(tabela_porownawcza)

# ==========================================
# 3. WYNIKI WEDŁUG OKRESÓW
# ==========================================

print("INCURRED — WYNIKI WEDŁUG OKRESÓW")
display(
    tabela_okresy[
        tabela_okresy["Model"] == "Incurred"
    ]
)

print("REZERWY — WYNIKI WEDŁUG OKRESÓW")
display(
    tabela_okresy[
        tabela_okresy["Model"] == "Rezerwy"
    ]
)

# ==========================================
# 4. DIAGNOSTYKA
# ==========================================

print("DIAGNOSTYKA OBSERWACJI")
display(diagnostyka)
