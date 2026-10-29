tabela_lc_freq = pd.DataFrame({
    "expo": ekspozycja,
    "LC_Nb_Rep": lc_nb_rep,
    "LC_Nb_Ult": lc_nb_ult,
    "LC_FREQ": lc_nb_ult / ekspozycja,
})

display(tabela_lc_freq)
