@staticmethod
def calculate_sigma(
    p_ij: pd.DataFrame,
    l_ij: pd.DataFrame,
    w_ij: pd.DataFrame,
    dev_j: list[float]
) -> list[list[float]]:

    max_col = l_ij.shape[1]

    # Tutaj przechowujemy prawdziwe sigma,
    # czyli ODCHYLENIA STANDARDOWE - tak jak w R.
    sigmas = []

    sd = []

    for j in range(max_col):

        numerator = 0.0
        denominator = 0.0
        denominator_sd = 0.0

        # ====================================================
        # STANDARDOWA ESTYMACJA SIGMA
        # ====================================================

        for i in range(len(l_ij)):

            try:
                w = w_ij.iloc[i, j]
                p = p_ij.iloc[i, j]
                l = l_ij.iloc[i, j]
                dev = dev_j[j]

                if (
                    not np.isnan(w)
                    and not np.isnan(p)
                    and not np.isnan(l)
                ):

                    numerator += (
                        w
                        * p
                        * (l - dev) ** 2
                    )

                    denominator += w

                    denominator_sd += (
                        w * p
                    )

            except IndexError:
                continue

        # ====================================================
        # NORMALNA KOLUMNA
        #
        # sigma_j^2 =
        # numerator / (denominator - 1)
        #
        # Ale zapisujemy sigma_j,
        # czyli robimy sqrt.
        # ====================================================

        if denominator > 1:

            sigma_squared = (
                numerator
                / (denominator - 1)
            )

            sigma = np.sqrt(
                sigma_squared
            )

        # ====================================================
        # OSTATNIA SIGMA - ESTYMACJA MACKA
        #
        # dokładnie zgodnie z R:
        #
        # sigma_i =
        #
        # sqrt(
        #   min(
        #     sigma[i-1]^4 / sigma[i-2]^2,
        #     sigma[i-2]^2,
        #     sigma[i-1]^2
        #   )
        # )
        #
        # ====================================================

        elif (
            j == max_col - 1
            and len(sigmas) >= 2
            and sigmas[j - 2] != 0
        ):

            ratio = (
                sigmas[j - 1] ** 4
                / sigmas[j - 2] ** 2
            )

            if (
                np.isnan(ratio)
                or np.isinf(ratio)
            ):

                sigma_squared = min(
                    sigmas[j - 2] ** 2,
                    sigmas[j - 1] ** 2,
                )

            else:

                sigma_squared = min(
                    ratio,
                    sigmas[j - 2] ** 2,
                    sigmas[j - 1] ** 2,
                )

            sigma = np.sqrt(
                abs(sigma_squared)
            )

        # ====================================================
        # BRAK MOŻLIWOŚCI ESTYMACJI
        # ====================================================

        else:

            sigma = 0.0

        # ====================================================
        # ZAPISUJEMY SIGMA - NIE KWADRAT
        # ====================================================

        sigmas.append(
            sigma
        )

        # ====================================================
        # SD
        #
        # Zostawiam tutaj Twoją dotychczasową logikę,
        # ale skoro sigma jest teraz odchyleniem standardowym,
        # nie wolno już traktować go jak sigma^2.
        # ====================================================

        if denominator_sd != 0:

            sd.append(
                sigma
                / denominator_sd
            )

        else:

            sd.append(
                0.0
            )

    # ========================================================
    # TWOJA DALSZA CZĘŚĆ KODU POTRZEBUJE SIGMA^2
    #
    # Dlatego dopiero tutaj kwadratujemy.
    # ========================================================

    sigmas_squared = [
        sigma ** 2
        for sigma in sigmas
    ]

    return [
        sigmas_squared,
        sd,
    ]
